import { promises as fs, openSync, closeSync, watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { openStore } from './store.mjs';
import { initializeInstance, createProject, getProjectUrls, VERSION } from './service.mjs';
import { generateProxyConfig, proxyHost } from './proxy.mjs';
import { prepareConfiguration, applyConfiguration } from './configure.mjs';
import { exportProject, importProject } from './migration.mjs';
import { deleteProject } from './project-lifecycle.mjs';
import { prepareSetup, assertSetupPorts, writeSetupFiles } from './setup.mjs';
import { createWebsite } from './create.mjs';
import { detectServer, formatDetection } from './server-detection.mjs';

const serverPath = fileURLToPath(new URL('./server.mjs', import.meta.url));
const valuedOptions = new Set(['data-dir', 'name', 'domain', 'slug', 'port', 'site-port', 'host', 'public-url', 'site-url', 'password', 'project', 'confirm', 'format', 'admin-domain', 'output', 'lines', 'file', 'link-mode', 'mode', 'proxy', 'proxy-host', 'traefik-entrypoint', 'traefik-cert-resolver']);
const booleanOptions = new Set(['help', 'version', 'json', 'follow', 'yes', 'no-start']);
const help = `LumaSite — editable websites through MCP

Usage: lumasite <command> [options]
       lumasite --version

  create [directory]    Create a project folder, answer setup questions, install and run
  setup        Guided terminal installer (new instance or website ZIP)
  detect       Inspect web proxies, Docker and ports 80/443 without changing them
  init         Initialize an instance and optionally create its first project
  configure    Change a stopped instance’s URLs, listener host/ports or project domain
  project create --name NAME --domain DOMAIN    Create another project
  project list                                 List project URLs
  project delete --project ID_OR_SLUG --confirm SLUG    Save recovery ZIP and delete
  start        Start both listeners in the background
  status       Show process identity, ports, URLs, and data path
  health       Check both listeners and readiness
  doctor       Diagnose configuration, process, listeners, and storage
  logs         Show logs (--lines 100, --follow)
  restart      Safely stop and start this instance
  stop         Stop only a process verified by its instance ID and PID
  credentials  Print local administrator and project credentials
  proxy        Generate Apache, Caddy or Traefik configuration
  backup       Save a private snapshot (--output DIRECTORY)
  export       Export one portable project ZIP (--project ID_OR_SLUG --output FILE.zip)
  import       Import a new website, or --mode update --project ID_OR_SLUG --confirm SLUG

All commands accept --data-dir DIRECTORY and --json.
Default data directory: $LUMASITE_DATA_DIR or ./.lumasite

Examples:
  lumasite create
  lumasite create my-website
  lumasite setup
  lumasite setup --mode server
  lumasite setup --yes --name "My website" --no-start
  lumasite init --name SendMailOS --domain sendmailos.local
  lumasite start
  lumasite status
  lumasite configure --public-url https://studio.example.com --site-url https://sites.example.com
  lumasite proxy --format caddy --admin-domain studio.example.com --domain example.com
  lumasite export --project sendmailos --output ./sendmailos.zip
  lumasite import --file ./sendmailos.zip --domain www.example.com --link-mode domain
  lumasite import --file ./sendmailos.zip --mode update --project sendmailos --confirm sendmailos

Init options: --port 4310 --site-port 4311 --host 127.0.0.1
              --public-url https://studio.example.com
              --site-url https://preview.example.com --password PASSWORD
Use a generated password or LUMASITE_PASSWORD to avoid shell history.

Setup options: --mode local|server --proxy auto|apache|caddy|traefik|none --file website.zip
               --name NAME --domain DOMAIN --data-dir DIRECTORY
               --port PORT --site-port PORT --public-url ORIGIN --site-url ORIGIN
               --yes (non-interactive) --no-start (initialize without starting)
Setup detects available default ports and existing proxies, then generates credentials and URLs.
Proxy options: --proxy-host HOST --traefik-entrypoint NAME --traefik-cert-resolver NAME
Server mode defaults to read-only proxy detection; ambiguous automation needs an explicit --proxy.
Server mode writes proxy configuration for review; DNS/TLS and reboot services are configured separately.

Configure options (instance must be stopped):
  --public-url ORIGIN --site-url ORIGIN --host 127.0.0.1|0.0.0.0|::1
  --port PORT --site-port PORT --domain DOMAIN [--project ID_OR_SLUG]
Omitted settings are preserved. Ports must be different integers from 1–65535.
Admin and website origins must differ. Set their URLs explicitly when migrating.
With --domain, a single project is inferred; multiple projects require --project.

Project import options: --name NAME --slug SLUG --domain DOMAIN
                        --link-mode project|domain (default: project)
Domain link mode requires --domain. Source domains are cleared unless supplied.
Project ZIPs contain pages, media, theme and history, without credentials.
Import creates a new project and private MCP token; it never replaces a project.
`;

function parseArgs(args) {
  const opts = {};
  const words = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h') { opts.help = true; continue; }
    if (!a.startsWith('--')) { words.push(a); continue; }
    const split = a.indexOf('=');
    const key = a.slice(2, split === -1 ? undefined : split);
    if (booleanOptions.has(key)) {
      if (split !== -1) throw new Error(`--${key} does not take a value.`);
      opts[key] = true;
    } else if (valuedOptions.has(key)) {
      const value = split === -1 ? args[++i] : a.slice(split + 1);
      if (!value || value.startsWith('--')) throw new Error(`--${key} requires a value.`);
      opts[key] = value;
    } else throw new Error(`Unknown option: --${key}. Run lumasite --help.`);
  }
  return { command: words[0], subcommand: words[1], extras: words.slice(2), opts };
}

function tcpPort(value, fallback, label) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be an integer between 1 and 65535.`);
  const port = Number(value);
  if (port < 1 || port > 65535) throw new Error(`${label} must be between 1 and 65535.`);
  return port;
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function savePrivateJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(tmp, file);
}

function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'EPERM') return true; if (error.code === 'ESRCH') return false; throw error; }
}

function localAddress(instance, site = false) {
  const host = ['0.0.0.0', '::'].includes(instance.host) ? '127.0.0.1' : instance.host;
  return `http://${host.includes(':') ? `[${host}]` : host}:${site ? instance.sitePort : instance.port}`;
}

async function request(url, { timeout = 1200, token } = {}) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  } catch (error) { return { ok: false, error: error.cause?.code || error.message }; }
}

async function health(instance) {
  const [admin, site, ready] = await Promise.all([
    request(`${localAddress(instance)}/health`),
    request(`${localAddress(instance, true)}/health`),
    request(`${localAddress(instance)}/ready`),
  ]);
  const ownsAdmin = admin.ok && admin.body.instanceId === instance.id;
  const ownsSite = site.ok && site.body.instanceId === instance.id;
  return { ok: ownsAdmin && ownsSite && ready.ok, admin: { ...admin, identity: ownsAdmin }, site: { ...site, identity: ownsSite }, ready };
}

async function instanceState(dataDir) {
  const store = await openStore(dataDir);
  const state = store.read();
  if (!state.instance) throw new Error(`No instance initialized at ${dataDir}. Run lumasite init --data-dir ${JSON.stringify(dataDir)}.`);
  return { store, state, instance: state.instance };
}

async function withControlLock(dataDir, action) {
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, '.control.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    let handle;
    try {
      handle = await fs.open(file, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let lock;
      try { lock = await readJson(file); } catch { /* A writer may still be finishing its lock file. */ }
      if (!lock || alive(lock.pid)) throw new Error('Another LumaSite lifecycle command is running. Try again shortly.');
      await fs.rm(file, { force: true });
      continue;
    }
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      await handle.close();
      return await action();
    } finally { await handle.close().catch(() => {}); await fs.rm(file, { force: true }); }
  }
  throw new Error('Could not acquire the instance lifecycle lock.');
}

function portIsOccupied(instance, site = false) {
  const address = new URL(localAddress(instance, site));
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: address.hostname.replace(/^\[|\]$/g, ''), port: site ? instance.sitePort : instance.port });
    let settled = false;
    const finish = (error, occupied) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      error ? reject(error) : resolve(occupied);
    };
    socket.once('connect', () => finish(null, true));
    socket.once('error', error => error.code === 'ECONNREFUSED'
      ? finish(null, false)
      : finish(new Error(`Cannot verify whether ${address.origin} is stopped (${error.code || error.message}).`)));
    socket.setTimeout(1200, () => finish(new Error(`Cannot verify whether ${address.origin} is stopped (connection timed out).`)));
  });
}

async function configureInstance(dataDir, options) {
  const { store, state, instance } = await instanceState(dataDir);
  // Check all values before any persistence or network-dependent decisions.
  const changes = prepareConfiguration(state, options);
  const run = await readJson(path.join(dataDir, 'run.json'));
  const check = await health(instance);
  if (check.admin.identity || check.site.identity) throw new Error('This instance is running. Stop it before changing configuration.');
  if (run && alive(run.pid)) throw new Error(`Recorded PID ${run.pid} is alive but cannot be verified. Refusing to configure a potentially running instance. No signal sent. Run doctor.`);
  const addresses = new Map();
  for (const candidate of [instance, changes.instance]) {
    for (const site of [false, true]) addresses.set(localAddress(candidate, site), { candidate, site });
  }
  for (const [address, { candidate, site }] of addresses) {
    if (await portIsOccupied(candidate, site)) throw new Error(`Listener ${address} is occupied by a service. Stop it before changing this instance’s configuration.`);
  }
  const updated = await applyConfiguration(store, options);
  const configured = updated.instance;
  return {
    status: 'configured', instanceId: configured.id, dataDir,
    host: configured.host, port: configured.port, sitePort: configured.sitePort,
    publicUrl: configured.publicUrl, sitePublicUrl: configured.sitePublicUrl,
    admin: `${configured.publicUrl}/admin`,
    projects: updated.projects.map(project => displayProject(updated, project)),
    message: 'Configuration saved while stopped. Pages, media, revisions and credentials are unchanged. Run lumasite start with the same --data-dir.',
  };
}

function displayProject(state, project) {
  return { id: project.id, name: project.name, slug: project.slug, domain: project.domain, ...getProjectUrls(state, project) };
}

async function statusReport(dataDir) {
  const { state, instance } = await instanceState(dataDir);
  const run = await readJson(path.join(dataDir, 'run.json'));
  const check = await health(instance);
  const verified = check.admin.identity && check.admin.body.pid === run?.pid && run?.instanceId === instance.id;
  return {
    status: check.ok ? 'running' : check.admin.identity || check.site.identity ? 'degraded' : 'stopped',
    healthy: check.ok, managed: Boolean(verified), instanceId: instance.id,
    pid: check.admin.identity ? check.admin.body.pid : null,
    recordedPid: run?.pid || null, recordedPidAlive: alive(run?.pid),
    host: instance.host, port: instance.port, sitePort: instance.sitePort,
    admin: `${instance.publicUrl}/admin`, localAdmin: `${localAddress(instance)}/admin`,
    dataDir, log: path.join(dataDir, 'logs/server.log'),
    projects: state.projects.map(project => displayProject(state, project)), checks: check,
  };
}

async function startServer(dataDir) {
  const { instance } = await instanceState(dataDir);
  const runPath = path.join(dataDir, 'run.json');
  const previous = await readJson(runPath);
  const previousHealth = await health(instance);
  if (previousHealth.admin.identity || previousHealth.site.identity) {
    if (!previousHealth.ok) throw new Error('This instance is already running but one listener is unhealthy. Run doctor, then stop or restart it.');
    return { ...(await statusReport(dataDir)), alreadyRunning: true };
  }
  if (previousHealth.admin.ok || previousHealth.site.ok) throw new Error('An instance port belongs to another service. Change the configured ports or stop the other service.');
  if (previous && alive(previous.pid)) throw new Error(`Recorded PID ${previous.pid} is alive but cannot be verified. Refusing to start a second instance or signal that PID. Run doctor.`);
  await fs.mkdir(path.join(dataDir, 'logs'), { recursive: true, mode: 0o700 });
  const logPath = path.join(dataDir, 'logs/server.log');
  await fs.appendFile(logPath, '', { mode: 0o600 });
  const log = openSync(logPath, 'a', 0o600);
  let child;
  try {
    child = spawn(process.execPath, [serverPath, '--data-dir', dataDir], {
      detached: true, stdio: ['ignore', log, log], env: { ...process.env, LUMASITE_DATA_DIR: dataDir },
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  } finally { closeSync(log); }
  child.unref();
  await savePrivateJson(runPath, { pid: child.pid, instanceId: instance.id, startedAt: new Date().toISOString(), serverPath });
  for (let attempt = 0; attempt < 70; attempt++) {
    const check = await health(instance);
    if (check.ok && check.admin.body.pid === child.pid) return { ...(await statusReport(dataDir)), alreadyRunning: false };
    if (!alive(child.pid)) {
      await fs.rm(runPath, { force: true });
      const tail = await tailLog(logPath, 12);
      throw new Error(`Server exited before becoming healthy. Check ${logPath}.\n${tail}`);
    }
    await delay(100);
  }
  throw new Error(`Server PID ${child.pid} started but did not become ready. Run lumasite doctor and lumasite logs --data-dir ${JSON.stringify(dataDir)}.`);
}

async function stopServer(dataDir) {
  const { instance } = await instanceState(dataDir);
  const runPath = path.join(dataDir, 'run.json');
  const run = await readJson(runPath);
  const check = await health(instance);
  if (!run) {
    if (check.admin.identity || check.site.identity) throw new Error('Instance is running without this CLI’s PID record. Stop its foreground process or container directly.');
    return { status: 'stopped', alreadyStopped: true };
  }
  if (!alive(run.pid)) {
    await fs.rm(runPath, { force: true });
    return { status: 'stopped', alreadyStopped: true, removedStalePid: true };
  }
  const identity = check.admin.identity ? check.admin.body : check.site.identity ? check.site.body : null;
  if (run.instanceId !== instance.id || identity?.pid !== run.pid) {
    throw new Error(`Cannot verify PID ${run.pid} belongs to this instance. No signal sent. Check doctor/logs and stop the verified foreground process directly.`);
  }
  process.kill(run.pid, 'SIGTERM');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!alive(run.pid)) {
      await fs.rm(runPath, { force: true });
      return { status: 'stopped', pid: run.pid, alreadyStopped: false };
    }
    await delay(100);
  }
  // Do not escalate to SIGKILL using a PID that may have been reused.
  throw new Error(`PID ${run.pid} did not stop after 10 seconds. Check logs; no SIGKILL was sent.`);
}

async function tailLog(file, count) {
  try {
    const stat = await fs.stat(file);
    const handle = await fs.open(file, 'r');
    try {
      const size = Math.min(stat.size, 2 * 1024 * 1024);
      const buffer = Buffer.alloc(size);
      await handle.read(buffer, 0, size, stat.size - size);
      const lines = buffer.toString('utf8').split('\n');
      if (lines.at(-1) === '') lines.pop();
      if (stat.size > size) lines.shift();
      return lines.slice(-count).join('\n');
    } finally { await handle.close(); }
  } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}

async function followLog(file, stdout, signal) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.appendFile(file, '', { mode: 0o600 });
  let offset = (await fs.stat(file)).size;
  let reading = false;
  let again = false;
  const readNew = async () => {
    if (reading) { again = true; return; }
    reading = true;
    try {
      do {
        again = false;
        const handle = await fs.open(file, 'r');
        try {
          const { size } = await handle.stat();
          if (size < offset) offset = 0;
          while (offset < size) {
            const buffer = Buffer.alloc(Math.min(size - offset, 65536));
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
            if (!bytesRead) break;
            offset += bytesRead;
            stdout.write(buffer.subarray(0, bytesRead));
          }
        } finally { await handle.close(); }
      } while (again && !signal.aborted);
    } catch (error) { if (error.code !== 'ENOENT') stdout.write(`Log read error: ${error.message}\n`); }
    finally { reading = false; }
  };
  const watcher = watch(path.dirname(file), () => { void readNew(); });
  const timer = setInterval(() => { void readNew(); }, 1000);
  try {
    await readNew();
    if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
  } finally { watcher.close(); clearInterval(timer); }
}

async function backup(dataDir, output) {
  const { store } = await instanceState(dataDir);
  const target = path.resolve(output || path.join(path.dirname(dataDir), `lumasite-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`));
  if (target === dataDir || target.startsWith(`${dataDir}${path.sep}`)) throw new Error('Backup destination must be outside the live data directory.');
  await fs.mkdir(target, { mode: 0o700 });
  try {
    // Capture state first; media/revisions are immutable once referenced by the state.
    const state = store.read();
    for (const entry of await fs.readdir(dataDir, { withFileTypes: true })) {
      if (['logs', 'run.json', '.control.lock', 'state.json'].includes(entry.name) || entry.name.endsWith('.tmp')) continue;
      if (entry.isSymbolicLink()) throw new Error(`Cannot back up symbolic link ${entry.name}.`);
      await fs.cp(path.join(dataDir, entry.name), path.join(target, entry.name), { recursive: true, errorOnExist: true, force: false });
    }
    await savePrivateJson(path.join(target, 'state.json'), state);
    await savePrivateJson(path.join(target, 'backup.json'), { product: 'LumaSite', createdAt: new Date().toISOString(), source: dataDir, instanceId: state.instance.id });
    return { status: 'saved', directory: target, containsCredentials: true, restore: `Stop the target instance, copy this snapshot into an empty data directory, then start with --data-dir.` };
  } catch (error) {
    await fs.writeFile(path.join(target, 'INCOMPLETE'), `${error.message}\n`, { mode: 0o600 }).catch(() => {});
    throw error;
  }
}

// A running server owns its in-memory store. Never write a separate disk copy
// merely because its API is unhealthy or a process has no CLI PID record.
async function migrationContext(dataDir) {
  const context = await instanceState(dataDir);
  const check = await health(context.instance);
  if (check.ok) {
    const credentials = await readJson(path.join(dataDir, 'credentials.json'));
    if (!credentials?.adminToken) throw new Error('The running instance requires its local administrator credentials.json for ZIP migration.');
    return { ...context, base: localAddress(context.instance), token: credentials.adminToken };
  }
  if (check.admin.identity || check.site.identity) throw new Error('This instance is running but unhealthy. Repair its administrator API or stop it before exporting/importing a project.');
  const run = await readJson(path.join(dataDir, 'run.json'));
  if (run && alive(run.pid)) throw new Error(`Recorded PID ${run.pid} is alive but cannot be verified. Refusing offline project migration. No signal sent. Run doctor.`);
  for (const site of [false, true]) {
    if (await portIsOccupied(context.instance, site)) throw new Error(`Listener ${localAddress(context.instance, site)} is occupied. Stop the service or repair its health before exporting/importing a project.`);
  }
  return context;
}

async function migrationApi(context, route, { method = 'GET', body, contentType = 'application/zip' } = {}) {
  const response = await fetch(`${context.base}${route}`, {
    method, body, signal: AbortSignal.timeout(120000),
    headers: { Authorization: `Bearer ${context.token}`, ...(body ? { 'Content-Type': contentType } : {}) },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Project migration failed (${response.status}).`);
  }
  return response;
}

async function exportZip(dataDir, options) {
  if (!options.project) throw new Error('Project export requires --project ID_OR_SLUG. Run lumasite project list to find it.');
  if (!options.output) throw new Error('Project export requires --output FILE.zip. Existing files are never overwritten.');
  const target = path.resolve(options.output);
  // Reserve the destination first so an existing archive is never overwritten.
  let handle;
  try { handle = await fs.open(target, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Export destination already exists: ${target}. Choose a new --output file.`);
    throw error;
  }
  try {
    const context = await migrationContext(dataDir);
    const projects = context.base
      ? (await (await migrationApi(context, '/api/projects')).json()).projects
      : context.state.projects;
    const project = projects.find(p => p.id === options.project) || projects.find(p => p.slug === options.project);
    if (!project) throw new Error('Project not found. Use its exact ID or slug from lumasite project list.');
    const buffer = context.base
      ? Buffer.from(await (await migrationApi(context, `/api/projects/${encodeURIComponent(project.id)}/export`)).arrayBuffer())
      : (await exportProject(context.store, project.id)).buffer;
    await handle.writeFile(buffer);
    await handle.sync();
    return { status: 'exported', file: target, bytes: buffer.length, projectId: project.id, containsCredentials: false, message: 'Portable project ZIP saved. Pages, media, theme and history are included; administrator passwords and MCP credentials are excluded.' };
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.rm(target, { force: true }).catch(() => {});
    throw error;
  } finally { await handle.close().catch(() => {}); }
}

async function importZip(dataDir, options) {
  if (!options.file) throw new Error('Project import requires --file FILE.zip.');
  if (options['link-mode'] !== undefined && !['project', 'domain'].includes(options['link-mode'])) throw new Error('--link-mode must be project or domain.');
  if (options['link-mode'] === 'domain' && !options.domain) throw new Error('--link-mode domain requires --domain. Use project mode for local project-path URLs.');
  const file = path.resolve(options.file);
  const handle = await fs.open(file, 'r');
  let buffer;
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('--file must refer to a regular project ZIP file.');
    if (info.size > 100 * 1024 * 1024) throw new Error('Project ZIP exceeds the 100 MiB compressed size limit.');
    buffer = await handle.readFile();
  } finally { await handle.close(); }
  const context = await migrationContext(dataDir);
  const settings = { mode: options.mode, name: options.name, slug: options.slug, domain: options.domain, linkMode: options['link-mode'] };
  if (options.mode === 'update') {
    const project = await migrationProject(context, options.project);
    settings.projectId = project.id; settings.confirmSlug = options.confirm;
  } else if (options.project || options.confirm) throw new Error('--project and --confirm require --mode update.');
  let result;
  if (context.base) {
    const query = new URLSearchParams(Object.entries(settings).filter(([, value]) => value !== undefined));
    result = await (await migrationApi(context, `/api/projects/import${query.size ? `?${query}` : ''}`, { method: 'POST', body: buffer })).json();
  } else result = await importProject(context.store, buffer, settings);
  const project = result.project;
  return {
    status: result.mode === 'update' ? 'updated' : 'imported', file, pages: result.pages, assets: result.assets, revisions: result.revisions, backup: result.backup, warnings: result.warnings,
    projects: [{ id: project.id, name: project.name, slug: project.slug, domain: project.domain, ...result.urls }],
    message: result.mode === 'update' ? 'Website content replaced. Its identity and MCP connection are preserved. Download the previous copy from Studio → Recovery ZIPs.' : 'Imported as a new project. Its new MCP token is saved privately in credentials.json; use lumasite credentials only when you need to retrieve it.',
  };
}

async function migrationProject(context, identifier) {
  if (!identifier) throw new Error('Choose --project ID_OR_SLUG from lumasite project list.');
  const projects = context.base ? (await (await migrationApi(context, '/api/projects')).json()).projects : context.state.projects;
  const project = projects.find(p => p.id === identifier) || projects.find(p => p.slug === identifier);
  if (!project) throw new Error('Project not found. Use its exact ID or slug from lumasite project list.');
  return project;
}

async function deleteWebsite(dataDir, options) {
  const context = await migrationContext(dataDir), project = await migrationProject(context, options.project);
  const settings = { confirmSlug: options.confirm };
  const result = context.base ? await (await migrationApi(context, `/api/projects/${project.id}/delete`, { method: 'POST', body: JSON.stringify(settings), contentType: 'application/json' })).json() : await deleteProject(context.store, project.id, settings);
  return { status: result.status, backup: result.backup, warnings: result.warnings, message: `Deleted ${project.name} (${project.slug}). Recovery ZIP saved; download it from Studio → Recovery ZIPs.` };
}

function print(value, opts, stdout) {
  if (typeof value === 'string' && !opts.json) { stdout.write(value.endsWith('\n') ? value : `${value}\n`); return; }
  if (opts.json) { stdout.write(JSON.stringify(value, null, 2) + '\n'); return; }
  if (value.status) stdout.write(`LumaSite: ${value.status}${value.pid ? ` (PID ${value.pid})` : ''}\n`);
  if (value.admin) stdout.write(`Admin: ${value.admin}\n`);
  if (value.port) stdout.write(`Admin/API/MCP port: ${value.port}\nWebsite port: ${value.sitePort}\n`);
  if (value.host) stdout.write(`Listen host: ${value.host}\n`);
  if (value.sitePublicUrl) stdout.write(`Website origin: ${value.sitePublicUrl}\n`);
  if (value.dataDir) stdout.write(`Data: ${value.dataDir}\n`);
  if (value.log) stdout.write(`Logs: ${value.log}\n`);
  if (value.file) stdout.write(`ZIP: ${value.file}\n`);
  if (value.bytes !== undefined) stdout.write(`Archive size: ${value.bytes} bytes\n`);
  if (value.backup) stdout.write(`Recovery ZIP: ${value.backup.filename}\nDownload in Studio → Recovery ZIPs\n`);
  for (const warning of value.warnings || []) stdout.write(`Warning: ${warning}\n`);
  if (value.pages !== undefined) stdout.write(`Pages: ${value.pages}; media: ${value.assets}; revisions: ${value.revisions}\n`);
  if (value.password) stdout.write(`Administrator password: ${value.password}\n`);
  if (value.adminToken) stdout.write(`Administrator API token: ${value.adminToken}\n`);
  for (const project of value.projects || []) {
    stdout.write(`\n${project.name} (${project.id})\n  Website: ${project.site}\n  Production: ${project.production || 'Domain not set'}\n  Admin: ${project.admin}\n  MCP: ${project.mcp}\n`);
    if (project.token) stdout.write(`  MCP bearer token: ${project.token}\n`);
  }
  if (value.message) stdout.write(`${value.message}\n`);
  if (value.directory) stdout.write(`Snapshot: ${value.directory}\nContains private credentials. Keep this directory private.\n`);
  if (value.checks && !value.port) stdout.write(JSON.stringify(value.checks, null, 2) + '\n');
}

export async function runCli(args, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
  let opts = {};
  try {
    const parsed = parseArgs(args);
    opts = parsed.opts;
    const { command, subcommand, extras } = parsed;
    if (opts.version) { stdout.write(`${VERSION}\n`); return 0; }
    if (opts.help || !command || command === 'help') { stdout.write(help); return 0; }
    if (extras.length || (subcommand && !['project', 'create'].includes(command))) throw new Error('Unexpected positional arguments. Run lumasite --help.');
    const allowed = {
      create: ['name', 'domain', 'slug', 'port', 'site-port', 'host', 'public-url', 'site-url', 'mode', 'proxy', 'proxy-host', 'traefik-entrypoint', 'traefik-cert-resolver', 'file', 'yes', 'no-start'],
      setup: ['name', 'domain', 'slug', 'port', 'site-port', 'host', 'public-url', 'site-url', 'mode', 'proxy', 'proxy-host', 'traefik-entrypoint', 'traefik-cert-resolver', 'file', 'yes', 'no-start'],
      init: ['name', 'domain', 'slug', 'port', 'site-port', 'host', 'public-url', 'site-url', 'password'],
      configure: ['public-url', 'site-url', 'host', 'port', 'site-port', 'domain', 'project'],
      project: subcommand === 'create' ? ['name', 'domain', 'slug'] : subcommand === 'delete' ? ['project', 'confirm'] : [],
      logs: ['lines', 'follow'], proxy: ['format', 'admin-domain', 'domain', 'project', 'output', 'proxy-host', 'traefik-entrypoint', 'traefik-cert-resolver'], backup: ['output'],
      export: ['project', 'output'], import: ['file', 'name', 'slug', 'domain', 'link-mode', 'mode', 'project', 'confirm'],
    }[command] || [];
    for (const key of Object.keys(opts)) {
      if (!['data-dir', 'json'].includes(key) && !allowed.includes(key)) throw new Error(`--${key} is not supported by ${command}. Run lumasite ${command} --help.`);
    }
    const dataDir = path.resolve(opts['data-dir'] || process.env.LUMASITE_DATA_DIR || path.join(process.cwd(), '.lumasite'));
    if (command === 'detect') {
      const report = await detectServer();
      if (opts.json) stdout.write(JSON.stringify(report) + '\n');
      else stdout.write(formatDetection(report) + '\n');
      return 0;
    }
    if (command === 'create') {
      const result = await createWebsite(subcommand, opts, { input: stdin, output: stdout, errors: stderr });
      if (!result) { print({ status: 'cancelled', message: 'No project was created.' }, opts, stdout); return 0; }
      print(result, opts, stdout); return result.startupError ? 1 : 0;
    }
    if (command === 'setup') {
      const plan = await prepareSetup(opts, { input: stdin, output: stdout });
      if (!plan) { print({ status: 'cancelled', message: 'No instance was created.' }, opts, stdout); return 0; }
      const result = await withControlLock(plan.dataDir, async () => {
        const store = await openStore(plan.dataDir);
        if (store.read().instance) throw new Error('This instance is already initialized. Use project create or import; setup never resets existing data.');
        await assertSetupPorts(plan);
        const created = await initializeInstance(store, { port: plan.port, sitePort: plan.sitePort, host: plan.host, publicUrl: plan.publicUrl, sitePublicUrl: plan.sitePublicUrl, password: process.env.LUMASITE_PASSWORD });
        const project = plan.archive
          ? await importProject(store, plan.archive, { name: plan.name, slug: plan.slug, domain: plan.domain, linkMode: plan.mode === 'server' ? 'domain' : 'project' })
          : await createProject(store, { name: plan.name, slug: plan.slug, domain: plan.domain });
        const files = await writeSetupFiles(plan);
        let runtime = {}, startupError;
        if (plan.start) {
          try { runtime = await startServer(plan.dataDir); }
          catch (error) { startupError = error.message; }
        }
        return {
          ...runtime, status: startupError ? 'needs attention' : plan.start ? 'running' : 'initialized',
          dataDir: plan.dataDir, port: plan.port, sitePort: plan.sitePort, host: plan.host,
          admin: `${plan.publicUrl}/admin`, sitePublicUrl: plan.sitePublicUrl,
          password: created.password, projects: [{ ...displayProject(store.read(), project.project), token: project.token }],
          ...files, detection: plan.detection, startupError,
          message: `${plan.archive ? 'Imported website ready; published revisions were preserved.' : 'Starter homepage created as a draft. Publish it in Studio or through MCP.'}\nCredentials saved privately in credentials.json.\n${files.proxyFile ? `Proxy configuration: ${files.proxyFile}\nPoint DNS to this server, then install the proxy configuration and enable HTTPS.\n` : ''}Setup notes: ${files.instructions}\n${Object.values(files.commands).join('\n')}${plan.mode === 'server' ? '\nUse a process supervisor for automatic startup after reboot.' : ''}${startupError ? `\nStartup needs attention: ${startupError}` : ''}`,
        };
      });
      print(result, opts, stdout); return result.startupError ? 1 : 0;
    }
    if (command === 'init') {
      const port = tcpPort(opts.port, 4310, 'Admin port');
      const sitePort = tcpPort(opts['site-port'], 4311, 'Website port');
      if (port === sitePort) throw new Error('Admin and website ports must be different.');
      const result = await withControlLock(dataDir, async () => {
        const store = await openStore(dataDir);
        const created = await initializeInstance(store, { port, sitePort, host: opts.host || '127.0.0.1', publicUrl: opts['public-url'], sitePublicUrl: opts['site-url'], password: opts.password || process.env.LUMASITE_PASSWORD });
        const project = opts.name ? await createProject(store, { name: opts.name, domain: opts.domain, slug: opts.slug }) : null;
        const state = store.read();
        return { status: 'initialized', dataDir, port, sitePort, admin: `${state.instance.publicUrl}/admin`, password: created.password, adminToken: created.adminToken, projects: project ? [{ ...displayProject(state, project.project), token: project.token }] : [], message: 'Credentials saved privately in credentials.json. Run lumasite start with the same --data-dir.' };
      });
      print(result, opts, stdout); return 0;
    }
    if (command === 'configure') {
      const result = await withControlLock(dataDir, () => configureInstance(dataDir, opts));
      print(result, opts, stdout); return 0;
    }
    if (command === 'export' || command === 'import') {
      const result = await withControlLock(dataDir, () => command === 'export' ? exportZip(dataDir, opts) : importZip(dataDir, opts));
      print(result, opts, stdout); return 0;
    }
    if (command === 'project') {
      if (subcommand === 'delete') {
        print(await withControlLock(dataDir, () => deleteWebsite(dataDir, opts)), opts, stdout); return 0;
      }
      const { store, state } = await instanceState(dataDir);
      const check = await health(state.instance);
      if (subcommand === 'list') {
        if (check.admin.identity) {
          const credentials = await readJson(path.join(dataDir, 'credentials.json'));
          const response = await request(`${localAddress(state.instance)}/api/projects`, { token: credentials?.adminToken });
          if (!response.ok) throw new Error(response.body?.error || 'Cannot list projects from the running server.');
          print({ projects: response.body.projects.map(p => ({ id: p.id, name: p.name, slug: p.slug, domain: p.domain, ...p.urls })) }, opts, stdout);
        } else print({ projects: state.projects.map(p => displayProject(state, p)) }, opts, stdout);
      }
      else if (subcommand === 'create') {
        if (!opts.name) throw new Error('Project creation requires --name.');
        if (!check.admin.identity && (check.site.identity || alive((await readJson(path.join(dataDir, 'run.json')))?.pid))) {
          throw new Error('Instance has a live process but its administrator API cannot be verified. Repair its health or stop it before creating a project.');
        }
        if (check.admin.identity) {
          const credentials = await readJson(path.join(dataDir, 'credentials.json'));
          const response = await fetch(`${localAddress(state.instance)}/api/projects`, {
            method: 'POST', signal: AbortSignal.timeout(10000),
            headers: { Authorization: `Bearer ${credentials?.adminToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: opts.name, domain: opts.domain, slug: opts.slug }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || `Project creation failed (${response.status}).`);
          print({ status: 'created', projects: [{ id: result.project.id, name: result.project.name, slug: result.project.slug, domain: result.project.domain, ...result.urls, token: result.token }] }, opts, stdout);
        } else {
          const result = await createProject(store, { name: opts.name, domain: opts.domain, slug: opts.slug });
          print({ status: 'created', projects: [{ ...displayProject(store.read(), result.project), token: result.token }] }, opts, stdout);
        }
      } else throw new Error('Use project create, project list, or project delete.');
      return 0;
    }
    if (command === 'start' || command === 'stop' || command === 'restart') {
      const result = await withControlLock(dataDir, async () => {
        if (command === 'stop') return stopServer(dataDir);
        if (command === 'restart') await stopServer(dataDir);
        return startServer(dataDir);
      });
      print(result, opts, stdout); return 0;
    }
    if (command === 'status') { const result = await statusReport(dataDir); print(result, opts, stdout); return result.healthy ? 0 : 1; }
    if (command === 'health') {
      const { instance } = await instanceState(dataDir);
      const check = await health(instance);
      print({ status: check.ok ? 'healthy' : 'unhealthy', checks: check }, opts, stdout);
      return check.ok ? 0 : 1;
    }
    if (command === 'doctor') {
      const report = await statusReport(dataDir);
      let writable = false;
      try { await fs.access(dataDir, 2); writable = true; } catch { /* Report read-only storage. */ }
      const issues = [];
      if (!report.healthy) issues.push('One or both listeners are down, not ready, or belong to another instance.');
      if (report.recordedPidAlive && !report.managed) issues.push('Recorded PID is alive but unverified. It will never be signalled automatically.');
      if (!writable) issues.push('Data directory is not writable.');
      const { instance } = await instanceState(dataDir);
      if (new URL(instance.publicUrl).hostname === 'localhost' && !['127.0.0.1', '::1', 'localhost'].includes(instance.host)) issues.push('Public URL uses localhost. Set the real HTTPS studio URL before remote access.');
      print({ ...report, status: issues.length ? 'needs attention' : 'healthy', checks: { ...report.checks, writable }, message: issues.length ? issues.join('\n') : 'Both listeners identify this instance and storage is writable.' }, opts, stdout);
      return issues.length ? 1 : 0;
    }
    if (command === 'logs') {
      const lineCount = opts.lines === undefined ? 100 : Number(opts.lines);
      if (!Number.isInteger(lineCount) || lineCount < 1 || lineCount > 10000) throw new Error('--lines must be between 1 and 10000.');
      const file = path.join(dataDir, 'logs/server.log');
      const tail = await tailLog(file, lineCount);
      if (opts.json) print({ file, lines: tail ? tail.split('\n') : [] }, opts, stdout);
      else stdout.write(tail ? `${tail}\n` : `No logs yet at ${file}\n`);
      if (opts.follow) {
        if (opts.json) throw new Error('--follow cannot be combined with --json.');
        const abort = new AbortController();
        const stop = () => abort.abort();
        process.once('SIGINT', stop); process.once('SIGTERM', stop);
        try { await followLog(file, stdout, abort.signal); }
        finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
      }
      return 0;
    }
    if (command === 'credentials') {
      const credentials = await readJson(path.join(dataDir, 'credentials.json'));
      if (!credentials) throw new Error('No credentials file found. Initialize an instance first.');
      print(JSON.stringify(credentials, null, 2), { ...opts, json: false }, stdout);
      return 0;
    }
    if (command === 'proxy') {
      const { state, instance } = await instanceState(dataDir);
      const project = opts.project ? state.projects.find(p => p.id === opts.project || p.slug === opts.project) : state.projects[0];
      const domain = opts.domain || project?.domain;
      const previewHost = instance.sitePublicUrl ? new URL(instance.sitePublicUrl).hostname : null;
      const siteDomain = previewHost && !['localhost', '127.0.0.1', '[::1]'].includes(previewHost) ? previewHost : null;
      let format = opts.format || 'apache';
      if (format === 'auto') {
        const report = await detectServer();
        if (report.recommendation.requiresChoice || report.recommendation.proxy === 'none') throw new Error(`${report.recommendation.reason} Supply --format apache|caddy|traefik explicitly.`);
        format = report.recommendation.proxy;
        if (report.proxies.find(proxy => proxy.id === format)?.containers.some(container => container.networkMode !== 'host') && !opts['proxy-host']) throw new Error('The detected Docker proxy needs --proxy-host with a reachable backend address. Container loopback cannot reach the native LumaSite server.');
      }
      const upstreamHost = proxyHost(opts['proxy-host'] || (instance.host === '::1' ? '::1' : '127.0.0.1'));
      if (!['127.0.0.1', 'localhost', '::1'].includes(upstreamHost) && instance.host !== '0.0.0.0') throw new Error('The configured loopback-only listener cannot be reached through this backend host. Configure a reachable listener first, and restrict backend access to the proxy network.');
      const config = generateProxyConfig({ format, adminDomain: opts['admin-domain'] || new URL(instance.publicUrl).hostname, domain, siteDomain, port: instance.port, sitePort: instance.sitePort, upstreamHost, traefikEntryPoint: opts['traefik-entrypoint'], traefikCertResolver: opts['traefik-cert-resolver'] });
      if (opts.output) { await fs.writeFile(path.resolve(opts.output), config, { flag: 'wx', mode: 0o600 }); print({ status: 'generated', message: `Configuration saved to ${path.resolve(opts.output)}. Review it before enabling it; no server settings were changed.` }, opts, stdout); }
      else print(opts.json ? { format, config } : config, opts, stdout);
      return 0;
    }
    if (command === 'backup') { print(await backup(dataDir, opts.output), opts, stdout); return 0; }
    throw new Error(`Unknown command: ${command}. Run lumasite --help.`);
  } catch (error) {
    if (error.code === 'SETUP_CANCELLED') { print({ status: 'cancelled', message: error.message }, opts, stdout); return 130; }
    const message = error?.message || String(error);
    if (opts.json) stderr.write(JSON.stringify({ error: message }) + '\n');
    else stderr.write(`LumaSite: ${message}\n`);
    return 1;
  }
}
