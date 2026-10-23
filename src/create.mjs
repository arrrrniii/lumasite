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

/** packageSpec can point at a packed release for offline/internal distribution. */
export async function createWebsite(selected, options, {
  input = process.stdin, output = process.stdout, errors = process.stderr, env = process.env,
  cwd = process.cwd(), packageSpec = `git+https://github.com/arrrrniii/lumasite.git#v${VERSION}`,
} = {}) {
  const directory = await projectDirectory(selected, options, { input, output, cwd });
  const chosenData = options['data-dir'] || './.lumasite';
  const dataDir = path.resolve(directory, chosenData);
  const dependencies = path.join(directory, 'node_modules');
  if (dataDir === path.parse(dataDir).root || dataDir === directory || directory.startsWith(`${dataDir}${path.sep}`) || dataDir === dependencies || dataDir.startsWith(`${dependencies}${path.sep}`)) throw new Error('Choose a dedicated data directory outside node_modules and separate from the project root.');
  // Questions and final review happen before any project files or dependencies are written.
  const plan = await prepareSetup({ ...options, 'data-dir': dataDir, defaultName: path.basename(directory) }, { input, output, env, cwd });
  if (!plan) return null;
  await newDirectory(directory);
  await fs.mkdir(path.dirname(directory), { recursive: true });
  await fs.mkdir(directory, { mode: 0o700 });
  const scripts = Object.fromEntries(['start', 'setup', 'status', 'health', 'doctor', 'restart', 'stop', 'logs', 'credentials', 'export', 'import', 'detect'].map(command => [command, `node lumasite.mjs ${command}`]));
  scripts.logs = 'node lumasite.mjs logs --follow';
  scripts['project:list'] = 'node lumasite.mjs project list';
  const pkg = { name: plan.slug, version: '1.0.0', private: true, type: 'module', engines: { node: '>=24' }, scripts, dependencies: { lumasite: packageSpec } };
  const relativeData = path.relative(directory, dataDir);
  const wrapper = `import { runCli } from 'lumasite/src/cli.mjs';\nimport path from 'node:path';\nimport { fileURLToPath } from 'node:url';\nconst args = process.argv.slice(2);\nif (!args.some(arg => arg === '--data-dir' || arg.startsWith('--data-dir='))) args.push('--data-dir', path.resolve(fileURLToPath(new URL('.', import.meta.url)), ${JSON.stringify(relativeData)}));\nprocess.exitCode = await runCli(args);\n`;
  const ignoredData = relativeData && !relativeData.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeData)
    ? `/${relativeData.split(path.sep).join('/').replace(/[\\*?[\]!# ]/g, '\\$&')}/\n` : '';
  const ignore = `node_modules/\n.lumasite/\n${ignoredData}.env\n.env.*\n*.zip\n*.tgz\n*.log\n.DS_Store\n.setup-import.zip\n`;
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', { flag: 'wx' });
  await fs.writeFile(path.join(directory, 'lumasite.mjs'), wrapper, { flag: 'wx' });
  await fs.writeFile(path.join(directory, '.gitignore'), ignore, { flag: 'wx' });
  const readme = `# ${plan.name}\n\nA LumaSite website with native LumaFX, Studio, and MCP.\n\nRun commands from this directory:\n\n\`\`\`sh\nnpm start\nnpm run status\nnpm run health\nnpm run detect\nnpm run logs\nnpm run restart\nnpm stop\n\`\`\`\n\nStudio: ${plan.publicUrl}/admin\nPreview: ${plan.sitePublicUrl}\nPersistent data: ${dataDir}\n\nUse Studio or MCP to edit and publish pages. A new homepage starts as a draft; an imported ZIP preserves published pages. Credentials stay in the private data directory. Reinstall dependencies with \`npm ci\`; website data is separate from \`node_modules\`.\n\nFor an interrupted first setup, run \`npm install\`, then \`npm run setup\`. An initialized instance is never reset by setup. Use \`npm run credentials\` to retrieve its saved connection credentials privately.\n\n${plan.mode === 'server' ? 'Enable your generated proxy configuration, point DNS to this server, and configure HTTPS. Use a process supervisor for automatic startup after reboot.\n' : ''}`;
  await fs.writeFile(path.join(directory, 'README.md'), readme, { flag: 'wx' });
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
