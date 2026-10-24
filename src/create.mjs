import { createInterface } from 'node:readline/promises';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { prepareSetup, shellQuote, writeDetectionReport } from './setup.mjs';
import { VERSION } from './service.mjs';

async function newDirectory(directory) {
  if (/[\u0000-\u001f\u007f]/.test(directory)) throw new Error('Project directory must not contain control characters.');
  try { await fs.lstat(directory); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(`Project directory already exists: ${directory}. Choose a new folder; no existing files were changed.`);
}

async function projectDirectory(selected, options, { input, output, cwd }) {
  if (selected) { const result = path.resolve(cwd, selected); await newDirectory(result); return result; }
  if (options.yes) throw new Error('Automated creation requires a project directory: lumasite create my-website --yes.');
  if (!input.isTTY || !output.isTTY || options.json) throw new Error('Project creation needs a terminal, or a project directory with --yes.');
  const rl = createInterface({ input, output, terminal: true, historySize: 0 }), abort = new AbortController();
  rl.on('SIGINT', () => abort.abort()); rl.on('close', () => abort.abort());
  output.write('\nCreate a LumaSite website\n\n');
  try {
    for (;;) {
      let answer;
      try { answer = (await rl.question('What is your project named? [my-website]: ', { signal: abort.signal })).trim() || 'my-website'; }
      catch (error) { if (abort.signal.aborted) throw Object.assign(new Error('Creation cancelled. No project was created.'), { code: 'SETUP_CANCELLED' }); throw error; }
      const result = path.resolve(cwd, answer);
      try { await newDirectory(result); return result; }
      catch (error) { output.write(`  ${error.message}\n`); }
    }
  } finally { rl.close(); }
}

function processResult(command, args, { cwd, env, progress, label }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', failure;
    const timer = setTimeout(() => { failure = new Error(`${label} timed out. The project files were kept for recovery.`); child.kill('SIGTERM'); }, 120000);
    child.stdout.on('data', bytes => { stdout += bytes; if (progress) progress.write(bytes); });
    child.stderr.on('data', bytes => { stderr += bytes; if (progress) progress.write(bytes); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0) {
        // Setup may return a complete credential report with a recoverable startup error.
        try { const result = JSON.parse(stdout); if (result.startupError) { resolve(result); return; } } catch {}
        reject(new Error(`${label} failed (${code}). ${stderr.trim().slice(-2000)}`));
      } else resolve(stdout);
    });
  });
}

function projectReadme(plan, dataDir) {
  const docs = `https://github.com/arrrrniii/lumasite/blob/v${VERSION}/docs`;
  return `# ${plan.name}

An editable LumaSite website with Studio, MCP, Tailwind, and native LumaFX.
Installed version: **${VERSION}**. Run commands from this project folder.

## Open your website

| Address | Purpose |
| --- | --- |
| ${plan.publicUrl}/admin | Studio: sign in with the generated administrator password |
| ${plan.sitePublicUrl} | Isolated website/preview origin |
${plan.domain ? `| https://${plan.domain}/ | Production website |\n` : ''}
Open **Connections** in Studio for the exact website preview, MCP URL, sitemap,
robots.txt, and RSS links. **Quick links** also provides these addresses.
Use \`npm run credentials\` only in a private terminal to retrieve saved credentials.

## Publish your first page

1. Open **Pages** and edit the starter homepage, or import a website ZIP.
2. Save a draft, open its preview, then choose **Publish**.
3. Connect an agent using the website's MCP URL from **Connections**.

A new homepage starts as a draft. A ZIP import keeps its published revisions.
Website edits publish without rebuilding or redeploying the Studio application.

| Studio area | What to configure |
| --- | --- |
| Global layout | Shared header, footer, CSS, and JavaScript |
| Connections | Website/domain, SEO defaults, branding, and MCP access |
| Integrations | Analytics, Search Console verification, Tag Manager, and other snippets |
| Forms & email | Form fields, private submissions, SMTP sender/recipients, and delivery tests |

SMTP needs your own server credentials. Save them in Studio, test the connection,
and enable notifications when ready. [Forms and email guide](${docs}/forms-and-email.md).
Before adding more pages, [set up a global layout](${docs}/global-layout.md).

## Everyday commands

| Command | Purpose |
| --- | --- |
| \`npm start\` | Start this installation, or show its existing process |
| \`npm run status\` | Show ports, addresses, logs, and storage |
| \`npm run health\` | Check both listeners |
| \`npm run doctor\` | Diagnose configuration and runtime |
| \`npm run detect\` | Inspect Apache, Caddy, Traefik, and ports 80/443 |
| \`npm run logs\` | Follow logs; Ctrl+C closes the log viewer |
| \`npm run restart\` | Restart this installation |
| \`npm stop\` | Stop this installation |
| \`npm run backup\` | Make a private full-instance snapshot in a new directory |
| \`npm run project:list\` | List websites and connection addresses |

Persistent data: \`${dataDir}\`.
Keep this directory across application updates. It contains private credentials,
website revisions/media, OAuth connections, and any form submissions or SMTP settings.
Full backups include the forms database and its encryption key; website ZIPs exclude
private submissions and SMTP credentials.

## Server setup

${plan.mode === 'server' ? 'The wizard generated deployment notes and any selected proxy configuration in your private data directory. Enable the reviewed proxy configuration, point DNS to this server, and configure HTTPS for Studio, preview, and website domains.' : 'This installation is local. To move online, create a server installation and transfer your website with Export ZIP → Import ZIP.'}

Use a supervisor for automatic startup after reboot. Native \`npm start\` does not
install a boot-time service. If Docker/systemd manages the process, use its
lifecycle commands. [Deployment and operations](${docs}/operations.md).

## Updates and recovery

For an application upgrade, stop the runtime, take a private backup, install the
chosen release, start again, and check health. Follow the
[generated-project upgrade guide](${docs}/website-management.md#upgrade-an-existing-generated-installation)
and [release notes](https://github.com/arrrrniii/lumasite/releases).
Do not rerun first-time creation to upgrade an initialized instance.

Reinstall the locked dependencies with \`npm ci --omit=dev --ignore-scripts\`.
For an interrupted first setup, run \`npm install\`, then \`npm run setup\`.
An initialized instance is never reset by setup.

The generated Git ignore rules exclude data, backups, credentials, and exports.
Keep those files private when sharing your project. The reusable application source
and installation guide live at [arrrrniii/lumasite](https://github.com/arrrrniii/lumasite).
`;
}

/** packageSpec can point at a packed release for offline/internal distribution. */
export async function createWebsite(selected, options, {
  input = process.stdin, output = process.stdout, errors = process.stderr, env = process.env,
  cwd = process.cwd(), packageSpec = VERSION,
} = {}) {
  if (options.local && options.mode && options.mode !== 'local') throw new Error('--local cannot be combined with --mode server.');
  const mode = options.local ? 'local' : options.mode || 'server';
  const directory = await projectDirectory(selected, options, { input, output, cwd });
  const chosenData = options['data-dir'] || './.lumasite';
  const dataDir = path.resolve(directory, chosenData);
  const dependencies = path.join(directory, 'node_modules');
  if (dataDir === path.parse(dataDir).root || dataDir === directory || directory.startsWith(`${dataDir}${path.sep}`) || dataDir === dependencies || dataDir.startsWith(`${dependencies}${path.sep}`)) throw new Error('Choose a dedicated data directory outside node_modules and separate from the project root.');
  // Questions and final review happen before any project files or dependencies are written.
  const plan = await prepareSetup({ ...options, mode, 'data-dir': dataDir, defaultName: path.basename(directory) }, { input, output, env, cwd });
  if (!plan) return null;
  await newDirectory(directory);
  await fs.mkdir(path.dirname(directory), { recursive: true });
  await fs.mkdir(directory, { mode: 0o700 });
  const scripts = Object.fromEntries(['start', 'setup', 'status', 'health', 'doctor', 'restart', 'stop', 'logs', 'credentials', 'export', 'import', 'detect', 'backup'].map(command => [command, `node lumasite.mjs ${command}`]));
  scripts.logs = 'node lumasite.mjs logs --follow';
  scripts['project:list'] = 'node lumasite.mjs project list';
  const pkg = { name: plan.slug, version: '1.0.0', private: true, type: 'module', engines: { node: '>=24' }, scripts, dependencies: { lumasite: packageSpec } };
  const relativeData = path.relative(directory, dataDir);
  const wrapper = `import { launchCli } from 'lumasite/src/bootstrap.mjs';\nimport path from 'node:path';\nimport { fileURLToPath } from 'node:url';\nconst args = process.argv.slice(2);\nif (!args.some(arg => arg === '--data-dir' || arg.startsWith('--data-dir='))) args.push('--data-dir', path.resolve(fileURLToPath(new URL('.', import.meta.url)), ${JSON.stringify(relativeData)}));\nprocess.exitCode = await launchCli(args);\n`;
  const ignoredData = relativeData && !relativeData.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeData)
    ? `/${relativeData.split(path.sep).join('/').replace(/[\\*?[\]!# ]/g, '\\$&')}/\n` : '';
  const ignore = `node_modules/\n.lumasite/\n${ignoredData}backups/\nexports/\nlumasite-backup-*/\ncredentials.json\noauth.json\nstate.json\nsmtp.key\nforms.sqlite*\n.env\n.env.*\n*.zip\n*.tgz\n*.log\n.DS_Store\n.setup-import.zip\n`;
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', { flag: 'wx' });
  await fs.writeFile(path.join(directory, 'lumasite.mjs'), wrapper, { flag: 'wx' });
  await fs.writeFile(path.join(directory, '.gitignore'), ignore, { flag: 'wx' });
  await fs.writeFile(path.join(directory, 'README.md'), projectReadme(plan, dataDir), { flag: 'wx' });
  const progress = options.json ? errors : output;
  let temporaryZip;
  try {
    progress.write(`\nCreating ${directory}\nInstalling LumaSite ${VERSION} and dependencies…\n`);
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    await processResult(npm, ['install', '--prefix', directory, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: directory, env, progress, label: 'Dependency installation' });
    const args = [path.join(directory, 'node_modules/lumasite/bin/lumasite.mjs'), 'setup', '--yes', '--json', '--data-dir', dataDir,
      '--mode', plan.mode, '--name', plan.name, '--slug', plan.slug, '--port', String(plan.port), '--site-port', String(plan.sitePort),
      '--host', plan.host, '--public-url', plan.publicUrl, '--site-url', plan.sitePublicUrl, '--proxy', plan.proxy, '--proxy-host', plan.upstreamHost];
    if (plan.proxy === 'traefik') args.push('--traefik-entrypoint', plan.traefikEntryPoint);
    if (plan.traefikCertResolver) args.push('--traefik-cert-resolver', plan.traefikCertResolver);
    if (plan.domain) args.push('--domain', plan.domain);
    if (!plan.start) args.push('--no-start');
    if (plan.archive) {
      temporaryZip = path.join(directory, '.setup-import.zip');
      await fs.writeFile(temporaryZip, plan.archive, { flag: 'wx', mode: 0o600 });
      args.push('--file', temporaryZip);
    }
    const configured = await processResult(process.execPath, args, { cwd: directory, env, label: 'Project setup' });
    const result = typeof configured === 'string' ? JSON.parse(configured) : configured;
    const detectionReport = await writeDetectionReport(plan);
    const notes = await fs.readFile(result.instructions, 'utf8');
    await fs.writeFile(result.instructions, notes.replace(/^lumasite /gm, 'node lumasite.mjs ') + (detectionReport ? `\nServer detection report: ${detectionReport}\n` : ''), { mode: 0o600 });
    const commands = Object.fromEntries(Object.keys(scripts).map(name => [name, name === 'start' ? 'npm start' : name === 'stop' ? 'npm stop' : `npm run ${name}`]));
    return { ...result, detection: plan.detection, detectionReport: detectionReport || result.detectionReport, projectDir: directory, commands, message: `Project created in ${directory}.\n\ncd ${shellQuote(directory)}\nnpm start\nnpm run status\nnpm run health\nnpm run detect\nnpm run logs\nnpm run restart\nnpm stop\n\n${plan.archive ? 'Imported published pages and drafts are ready.' : 'Publish your starter homepage in Studio or through MCP.'}\nCredentials are saved privately in the data directory.${result.proxyFile ? `\nProxy configuration: ${result.proxyFile}\nEnable the proxy, DNS, and HTTPS through your server setup.` : ''}${result.startupError ? `\nStartup needs attention: ${result.startupError}` : ''}` };
  } catch (error) {
    throw new Error(`${error.message}\nProject files were kept at ${directory}. To retry, run:\ncd ${shellQuote(directory)}\nnpm install\nnpm run setup`);
  } finally { if (temporaryZip) await fs.rm(temporaryZip, { force: true }); }
}
