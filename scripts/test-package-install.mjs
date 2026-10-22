// Install the actual distributable into a disposable prefix, then run its CLI.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile), source = fileURLToPath(new URL('..', import.meta.url));
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lumasite-package-'));
const prefix = path.join(directory, 'installed'), dataDir = path.join(directory, 'websites');
const app = path.join(directory, 'created website');
const bin = path.join(prefix, process.platform === 'win32' ? 'lumasite.cmd' : 'bin/lumasite');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (file, args, cwd = directory) => exec(file, args, { cwd, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
async function ports() {
  const servers = await Promise.all([0, 1].map(() => new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server));
  })));
  const values = servers.map(server => server.address().port);
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); return values;
}
try {
  const [archive] = JSON.parse((await run(npm, ['pack', '--json', '--pack-destination', directory], source)).stdout);
  const files = archive.files.map(file => file.path);
  for (const needed of ['bin/lumasite.mjs', 'bin/create-lumasite.mjs', 'src/create.mjs', 'src/setup.mjs', 'src/server.mjs', 'public/admin.html', 'vendor/lumafx/lumafx.global.js', 'vendor/lumafx/LICENSE']) assert.ok(files.includes(needed), `Missing package file: ${needed}`);
  assert.equal(files.some(file => /(^|\/)(?:\.lumasite|node_modules|marketing|test-results|\.env|credentials\.json|state\.json)(?:\/|$)/.test(file) || /\.(zip|log|pem|key)$/.test(file)), false);
  await run(npm, ['install', '--global', '--prefix', prefix, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', path.join(directory, archive.filename)]);
  assert.match((await run(bin, ['--help'])).stdout, /Guided terminal installer/);
  assert.equal((await run(bin, ['--version'])).stdout.trim(), archive.version);
  const [port, sitePort] = await ports();
  const setup = JSON.parse((await run(bin, ['setup', '--yes', '--name', 'Installed package', '--port', String(port), '--site-port', String(sitePort), '--data-dir', dataDir, '--json'])).stdout);
  assert.equal(setup.healthy, true); assert.equal(setup.managed, true);
  for (const route of ['/admin', '/admin-assets/admin.js', '/admin-assets/admin.css', '/runtime/lumafx/lumafx.global.js']) assert.equal((await fetch(`http://127.0.0.1:${port}${route}`)).status, 200, route);
  const projectId = setup.projects[0].id;
  const auth = { Authorization: `Bearer ${setup.projects[0].token}` };
  const credentials = JSON.parse(await fs.readFile(path.join(dataDir, 'credentials.json')));
  const headers = { Authorization: `Bearer ${credentials.adminToken}` };
  const pageResponse = await fetch(`http://127.0.0.1:${port}/api/projects/${projectId}/pages`, { headers });
  assert.equal(pageResponse.status, 200); const page = (await pageResponse.json()).pages[0];
  const publish = await fetch(`http://127.0.0.1:${port}/api/projects/${projectId}/pages/${page.id}/publish`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(publish.status, 200, 'Installed Tailwind compiler can publish a page');
  assert.equal((await fetch(`http://127.0.0.1:${sitePort}/sites/installed-package/`)).status, 200);
  // An authenticated MCP initialize confirms runtime SDK files/dependencies were included.
  const mcp = await fetch(`http://127.0.0.1:${port}/mcp/${projectId}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'package-install-test', version: '1.0.0' } } }) });
  assert.equal(mcp.status, 200);
  await mcp.body.cancel();
  assert.equal(JSON.parse((await run(bin, ['health', '--data-dir', dataDir, '--json'])).stdout).status, 'healthy');
  const websiteZip = path.join(directory, 'website.zip');
  await run(bin, ['export', '--project', projectId, '--output', websiteZip, '--data-dir', dataDir, '--json']);
  await run(bin, ['stop', '--data-dir', dataDir, '--json']);
  const packageRoot = path.join(prefix, 'lib/node_modules/lumasite');
  const { createWebsite } = await import(pathToFileURL(path.join(packageRoot, 'src/create.mjs')));
  const [appPort, appSitePort] = await ports();
  const created = await createWebsite(app, { yes: true, name: 'Created website', file: websiteZip, port: String(appPort), 'site-port': String(appSitePort), 'data-dir': 'private data' }, { packageSpec: `file:${path.join(directory, archive.filename)}`, output: { write() {} }, errors: { write() {} } });
  assert.equal(created.healthy, true); assert.equal(created.projectDir, app); assert.equal(created.commands.start, 'npm start');
  const appPackage = JSON.parse(await fs.readFile(path.join(app, 'package.json'), 'utf8'));
  assert.equal(appPackage.scripts.start, 'node lumasite.mjs start');
  assert.ok(await fs.stat(path.join(app, 'package-lock.json')));
  await assert.rejects(fs.access(path.join(app, '.setup-import.zip')), { code: 'ENOENT' });
  const runRecord = JSON.parse(await fs.readFile(path.join(app, 'private data/run.json')));
  assert.equal(runRecord.serverPath, await fs.realpath(path.join(app, 'node_modules/lumasite/src/server.mjs')));
  assert.match(await fs.readFile(path.join(app, '.gitignore'), 'utf8'), /\/private\\ data\//);
  await fs.rm(prefix, { recursive: true, force: true });
  assert.equal(JSON.parse((await run(process.execPath, [path.join(app, 'lumasite.mjs'), 'health', '--json'])).stdout).status, 'healthy', 'Created project survives removal of temporary installer');
  assert.equal((await fetch(`http://127.0.0.1:${appPort}/admin`)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${appSitePort}/sites/${created.projects[0].slug}/`)).status, 200, 'Creator imports published website revisions');
  console.log(JSON.stringify({ package: archive.name, version: archive.version, files: files.length, bytes: archive.size, globalInstall: 'passed', setup: 'passed', studio: 'passed', publish: 'passed', mcp: 'passed', create: 'passed', independentRuntime: 'passed' }));
} finally {
  await run(process.execPath, [path.join(app, 'lumasite.mjs'), 'stop', '--json']).catch(() => {});
  await run(bin, ['stop', '--data-dir', dataDir, '--json']).catch(() => {});
  await fs.rm(directory, { recursive: true, force: true });
}
