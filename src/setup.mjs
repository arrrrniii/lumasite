import { createInterface } from 'node:readline/promises';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { prepareConfiguration } from './configure.mjs';
import { generateProxyConfig } from './proxy.mjs';
import { inspectProjectArchive, MIGRATION_LIMITS } from './migration.mjs';

export const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const slugFor = name => name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const cancelled = () => Object.assign(new Error('Setup cancelled. No instance was created.'), { code: 'SETUP_CANCELLED' });

export async function portAvailable(port, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', error => error.code === 'EADDRINUSE' ? resolve(false) : reject(new Error(`Cannot use ${host}:${port}: ${error.code || error.message}`)));
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

async function suggestedPorts(host, options) {
  const selected = [], supplied = [options.port, options['site-port']];
  for (let i = 0; i < 2; i++) {
    if (supplied[i] !== undefined) { selected.push(Number(supplied[i])); continue; }
    let found;
    for (let port = 4310; port <= 4565; port++) {
      if (selected.includes(port) || Number(supplied[1 - i]) === port) continue;
      if (await portAvailable(port, host)) { found = port; break; }
    }
    if (!found) throw new Error('No free default port was found. Supply --port and --site-port.');
    selected.push(found);
  }
  return selected;
}

export function validateSetupPlan(values) {
  const mode = values.mode || 'local';
  if (!['local', 'server'].includes(mode)) throw new Error('Setup mode must be local or server.');
  const name = String(values.name || '').trim();
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Website name must contain 1–100 printable characters.');
  const slug = values.slug || slugFor(name);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) throw new Error('Choose --slug using lowercase letters, numbers and hyphens.');
  const port = Number(values.port), sitePort = Number(values.sitePort);
  if (![port, sitePort].every(p => Number.isInteger(p) && p >= 1024 && p <= 65535)) throw new Error('Choose ports between 1024 and 65535.');
  const project = { id: 'setup-project', domain: '' };
  const base = { host: values.host || '127.0.0.1', port, sitePort, publicUrl: values.publicUrl, sitePublicUrl: values.sitePublicUrl };
  const checked = prepareConfiguration({ instance: base, projects: [project] }, {
    host: base.host, port: String(port), 'site-port': String(sitePort),
    'public-url': values.publicUrl, 'site-url': values.sitePublicUrl,
    ...(values.domain ? { domain: values.domain } : {}),
  });
  const domain = checked.project?.domain || '';
  const proxy = values.proxy || (mode === 'server' ? 'apache' : 'none');
  if (!['apache', 'caddy', 'none'].includes(proxy)) throw new Error('Proxy must be apache, caddy or none.');
  if (mode === 'local' && proxy !== 'none') throw new Error('Choose server mode to generate a reverse proxy configuration.');
  if (mode === 'server') {
    if (!domain || !domain.includes('.') || domain.endsWith('.local')) throw new Error('Server setup requires a production domain, such as example.com.');
    const admin = new URL(checked.instance.publicUrl), site = new URL(checked.instance.sitePublicUrl);
    if ([admin, site].some(url => url.protocol !== 'https:' || url.port)) throw new Error('Server URLs must use HTTPS without a custom port.');
    if (admin.hostname === domain || admin.hostname === site.hostname) throw new Error('Studio, website, and preview scripts must use separate administration and public hostnames.');
  }
  const dataDir = path.resolve(values.dataDir);
  if (/[\u0000-\u001f\u007f]/.test(dataDir)) throw new Error('The data directory must not contain control characters.');
  const proxyConfig = proxy === 'none' ? null : generateProxyConfig({
    format: proxy, adminDomain: new URL(checked.instance.publicUrl).hostname, domain,
    siteDomain: new URL(checked.instance.sitePublicUrl).hostname, port, sitePort,
  });
  return { ...values, mode, name, slug, domain, dataDir, proxy, proxyConfig, ...checked.instance };
}

async function emptyInstance(dataDir) {
  try {
    const state = JSON.parse(await fs.readFile(path.join(dataDir, 'state.json'), 'utf8'));
    if (state.instance) throw new Error(`An instance already exists at ${dataDir}. Use lumasite project create or import with that --data-dir; setup never resets it.`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export async function prepareSetup(options, { input = process.stdin, output = process.stdout, env = process.env, cwd = process.cwd() } = {}) {
  const interactive = !options.yes;
  if (interactive && (!input.isTTY || !output.isTTY || options.json)) throw new Error('Interactive setup needs a terminal. For automation use setup --yes --name "My website" (or --file website.zip), plus your settings.');
  if (options.yes && !options.name && !options.file) throw new Error('Non-interactive setup requires --name or --file.');
  if (env.LUMASITE_PASSWORD && (env.LUMASITE_PASSWORD.length < 12 || env.LUMASITE_PASSWORD.length > 1024)) throw new Error('LUMASITE_PASSWORD must contain 12–1024 characters.');
  if (options.host && !['127.0.0.1', '0.0.0.0', '::1'].includes(options.host)) throw new Error('Listener host must be 127.0.0.1, 0.0.0.0 or ::1.');
  let rl;
  const abort = new AbortController();
  const ask = async (label, fallback = '', validate = () => {}) => {
    if (!interactive) { validate(fallback); return fallback; }
    for (;;) {
      let value;
      try { value = (await rl.question(`${label}${fallback !== '' ? ` [${fallback}]` : ''}: `, { signal: abort.signal })).trim() || fallback; }
      catch (error) { if (abort.signal.aborted) throw cancelled(); throw error; }
      try { validate(value); return value; } catch (error) { output.write(`  ${error.message}\n`); }
    }
  };
  try {
    if (interactive) {
      output.write('\nLumaSite setup\nCreate an editable website and its Studio/MCP connection.\n\n');
      rl = createInterface({ input, output, terminal: true, historySize: 0 });
      rl.on('SIGINT', () => abort.abort());
      rl.on('close', () => abort.abort());
    }
    const mode = options.mode || await ask('Run locally or on a server? local/server', 'local', value => { if (!['local', 'server'].includes(value)) throw new Error('Enter local or server.'); });
    if (!['local', 'server'].includes(mode)) throw new Error('--mode must be local or server.');
    const dataDir = path.resolve(cwd, options['data-dir'] || env.LUMASITE_DATA_DIR || await ask('Persistent data directory', './.lumasite'));
    await emptyInstance(dataDir);
    const file = options.file || await ask('Import a website ZIP? Leave empty for a new website');
    let archive, imported;
    if (file) {
      const handle = await fs.open(path.resolve(cwd, file), 'r');
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > MIGRATION_LIMITS.archive) throw new Error('Choose a regular website ZIP no larger than 100 MiB.');
        archive = await handle.readFile();
      } finally { await handle.close(); }
      imported = await inspectProjectArchive(archive);
    }
    const name = options.name || await ask('Website name', imported?.project.name || 'My website', value => { if (!value.trim() || value.length > 100) throw new Error('Use 1–100 characters.'); });
    const domain = options.domain ?? await ask('Website domain (hostname only)', mode === 'server' ? imported?.project.domain || '' : '');
    const host = options.host || '127.0.0.1';
    const defaults = await suggestedPorts(host, options);
    const checkPort = value => {
      if (!/^\d+$/.test(String(value)) || Number(value) < 1024 || Number(value) > 65535) throw new Error('Choose a port between 1024 and 65535.');
    };
    // ask's validation is synchronous; socket availability is checked together below.
    const port = options.port || await ask('Admin/API/MCP port', String(defaults[0]), value => { if (!/^\d+$/.test(value) || +value < 1024 || +value > 65535) throw new Error('Choose a port between 1024 and 65535.'); });
    const sitePort = options['site-port'] || await ask('Website/media port', String(defaults[1]), value => { if (value === String(port) || !/^\d+$/.test(value) || +value < 1024 || +value > 65535) throw new Error('Choose a different port between 1024 and 65535.'); });
    checkPort(port); checkPort(sitePort);
    const stem = domain.replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/^www\./, '');
    const publicUrl = options['public-url'] || await ask('Studio URL', mode === 'server' ? `https://studio.${stem}` : `http://localhost:${port}`);
    const sitePublicUrl = options['site-url'] || await ask('Preview URL', mode === 'server' ? `https://preview.${stem}` : `http://localhost:${sitePort}`);
    const proxy = options.proxy || (mode === 'server' ? await ask('Reverse proxy: apache/caddy/none', 'apache', value => { if (!['apache', 'caddy', 'none'].includes(value)) throw new Error('Enter apache, caddy or none.'); }) : 'none');
    const startAnswer = options['no-start'] ? 'n' : await ask('Start LumaSite after setup? y/n', 'y', value => { if (!/^(y|yes|n|no)$/i.test(value)) throw new Error('Enter y or n.'); });
    const plan = validateSetupPlan({ mode, dataDir, name, slug: options.slug || imported?.project.slug, domain, host, port, sitePort, publicUrl, sitePublicUrl, proxy, start: /^y(es)?$/i.test(startAnswer), archive });
    await assertSetupPorts(plan);
    if (interactive) {
      output.write(`\nWebsite: ${plan.name}${plan.domain ? ` — ${plan.domain}` : ''}\nData: ${plan.dataDir}\nStudio: ${plan.publicUrl}/admin\nPreview: ${plan.sitePublicUrl}\nPorts: ${plan.port} / ${plan.sitePort}\n${imported ? `Import: ${imported.pages} pages, ${imported.assets} media files\n` : 'New website: starter homepage draft\n'}Proxy: ${plan.proxy}\n\n`);
      const confirmation = await ask('Create this instance? y/n', 'y', value => { if (!/^(y|yes|n|no)$/i.test(value)) throw new Error('Enter y or n.'); });
      if (!/^y(es)?$/i.test(confirmation)) return null;
    }
    return plan;
  } finally { rl?.close(); }
}

export async function assertSetupPorts(plan) {
  for (const port of [plan.port, plan.sitePort]) {
    if (!await portAvailable(port, plan.host)) throw new Error(`Port ${port} is already in use. Choose different --port and --site-port values; no existing process was stopped.`);
  }
}

export async function writeSetupFiles(plan) {
  const directory = path.join(plan.dataDir, 'deployment');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  let proxyFile = null;
  if (plan.proxyConfig) {
    proxyFile = path.join(directory, plan.proxy === 'apache' ? 'apache.conf' : 'Caddyfile');
    await fs.writeFile(proxyFile, plan.proxyConfig, { flag: 'wx', mode: 0o600 });
  }
  const suffix = `--data-dir ${shellQuote(plan.dataDir)}`;
  const commands = Object.fromEntries(['start', 'status', 'health', 'doctor', 'logs --follow', 'restart', 'stop', 'credentials', 'project list'].map(command => [command, `lumasite ${command} ${suffix}`]));
  const next = `# LumaSite setup\n\nWebsite: ${plan.name}${plan.domain ? ` (${plan.domain})` : ''}\nStudio: ${plan.publicUrl}/admin\nPreview: ${plan.sitePublicUrl}\nAdmin/API/MCP: ${plan.host}:${plan.port}\nWebsite/media: ${plan.host}:${plan.sitePort}\n\n${plan.mode === 'server' ? `Point your website, Studio, and preview DNS records to this server.\n${proxyFile ? `Review the generated proxy configuration at ${proxyFile}.\nInstall it through your server's existing configuration workflow and enable HTTPS.\n` : 'Configure your reverse proxy and HTTPS for these origins.\n'}Native start runs in the background; configure a process supervisor for startup after reboot.\n\n` : ''}${plan.archive ? 'The ZIP retains published pages and drafts; its project gets a new MCP token.\n' : 'The starter homepage is a draft. Publish it in Studio or through MCP to make it public.\n'}\n${Object.values(commands).join('\n')}\n\nAdministrator credentials and project tokens are stored privately in credentials.json.\nApplication updates use npm; websites and media stay in this data directory.\n`;
  const instructions = path.join(directory, 'NEXT-STEPS.txt');
  await fs.writeFile(instructions, next, { flag: 'wx', mode: 0o600 });
  return { proxyFile, instructions, commands };
}
