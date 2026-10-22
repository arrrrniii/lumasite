// Install the actual distributable into a disposable prefix, then run its CLI.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile), source = fileURLToPath(new URL('..', import.meta.url));
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lumasite-package-'));
const prefix = path.join(directory, 'installed'), dataDir = path.join(directory, 'websites');
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
  for (const needed of ['bin/lumasite.mjs', 'src/setup.mjs', 'src/server.mjs', 'public/admin.html', 'vendor/lumafx/lumafx.global.js', 'vendor/lumafx/LICENSE']) assert.ok(files.includes(needed), `Missing package file: ${needed}`);
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
  console.log(JSON.stringify({ package: archive.name, version: archive.version, files: files.length, bytes: archive.size, globalInstall: 'passed', setup: 'passed', studio: 'passed', publish: 'passed', mcp: 'passed' }));
} finally {
  await run(bin, ['stop', '--data-dir', dataDir, '--json']).catch(() => {});
  await fs.rm(directory, { recursive: true, force: true });
}
