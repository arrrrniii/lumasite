import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store.mjs';
import { initializeInstance, createProject, createPage, publishPage, uploadAsset } from '../src/service.mjs';
import { startServers } from '../src/server.mjs';
import { prepareConfiguration } from '../src/configure.mjs';

const execute = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/lumasite.mjs', import.meta.url));
async function freePorts() {
  const servers = await Promise.all([0, 1].map(() => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  })));
  const ports = servers.map(server => server.address().port);
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  return ports;
}
async function fixture(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'lumasite-configure-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const [port, sitePort] = await freePorts();
  const store = await openStore(dataDir);
  const credentials = await initializeInstance(store, { password: 'Configure-Integration-123!', host: '127.0.0.1', port, sitePort });
  const first = await createProject(store, { name: 'Migration Example', domain: 'old.example.test' });
  const page = await createPage(store, first.project.id, { title: 'Keep this page', slug: 'migration-proof', html: '<main class="bg-blue-500"><h1>Preserved content</h1></main>', css: '.proof { color: blue; }', js: 'window.preserved = true;' });
  await publishPage(store, first.project.id, page.id);
  const asset = await uploadAsset(store, first.project.id, { name: 'original.png', mime: 'image/png', data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6PtQAAAAASUVORK5CYII=', 'base64') });
  const command = async (...args) => {
    try {
      const result = await execute(process.execPath, [bin, ...args, '--data-dir', dataDir, '--json'], { timeout: 15000, maxBuffer: 1024 * 1024 });
      return { code: 0, ...result, data: JSON.parse(result.stdout) };
    } catch (error) {
      return { code: error.code, stdout: error.stdout || '', stderr: error.stderr || '', data: error.stdout ? JSON.parse(error.stdout) : null };
    }
  };
  const stateBytes = () => readFile(path.join(dataDir, 'state.json'));
  return { dataDir, store, credentials, first, page, asset, port, sitePort, command, stateBytes };
}
function noSecrets(output, f) {
  for (const secret of [f.credentials.password, f.credentials.adminToken, f.first.token, f.store.read().instance.passwordHash, f.store.read().instance.adminTokenHash, f.store.read().projects[0].tokenHash]) {
    assert.equal(output.includes(secret), false, 'Public configuration output does not expose credentials or hashes');
  }
}

test('configure migrates a stopped instance atomically without touching content, IDs or credentials', async t => {
  const f = await fixture(t);
  const before = f.store.read();
  const privateBytes = await readFile(path.join(f.dataDir, 'credentials.json'));
  const assetFile = path.join(f.dataDir, 'media', f.asset.projectId, f.asset.filename);
  const mediaBytes = await readFile(assetFile);
  const [port, sitePort] = await freePorts();
  const result = await f.command('configure', '--public-url', 'https://Studio.example.test/', '--site-url', 'https://Preview.example.test/', '--host', '0.0.0.0', '--port', String(port), '--site-port', String(sitePort), '--domain', 'SendMailOS.example.test.');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.data.status, 'configured');
  assert.equal(result.data.instanceId, before.instance.id);
  assert.equal(result.data.host, '0.0.0.0');
  assert.equal(result.data.port, port);
  assert.equal(result.data.sitePort, sitePort);
  assert.equal(result.data.publicUrl, 'https://studio.example.test');
  assert.equal(result.data.sitePublicUrl, 'https://preview.example.test');
  assert.equal(result.data.projects[0].mcp, `https://studio.example.test/mcp/${f.first.project.id}`);
  assert.equal(result.data.projects[0].admin, `https://studio.example.test/admin/projects/${f.first.project.id}`);
  assert.equal(result.data.projects[0].site, `https://preview.example.test/sites/${f.first.project.slug}/`);
  assert.equal(result.data.projects[0].production, 'https://sendmailos.example.test/');
  const after = JSON.parse((await f.stateBytes()).toString());
  const expected = structuredClone(before);
  Object.assign(expected.instance, { host: '0.0.0.0', port, sitePort, publicUrl: 'https://studio.example.test', sitePublicUrl: 'https://preview.example.test' });
  expected.projects[0].domain = 'sendmailos.example.test';
  assert.deepEqual(after, expected, 'Every unrelated state field remains identical');
  assert.deepEqual(await readFile(path.join(f.dataDir, 'credentials.json')), privateBytes);
  assert.deepEqual(await readFile(assetFile), mediaBytes);
  assert.equal((await stat(path.join(f.dataDir, 'state.json'))).mode & 0o077, 0);
  await assert.rejects(access(path.join(f.dataDir, 'run.json')));
  noSecrets(result.stdout, f);
});

test('configure validates project selection and uniqueness before changing anything', async t => {
  const f = await fixture(t);
  const second = await createProject(f.store, { name: 'Second Project', domain: 'second.example.test' });
  for (const args of [
    ['--domain', 'new.example.test'],
    ['--domain', 'new.example.test', '--project', 'missing-project'],
    ['--domain', 'second.example.test', '--project', f.first.project.slug],
    ['--project', f.first.project.id],
  ]) {
    const before = await f.stateBytes();
    const result = await f.command('configure', ...args);
    assert.equal(result.code, 1, args.join(' '));
    assert.deepEqual(await f.stateBytes(), before);
  }
  const bySlug = await f.command('configure', '--domain', 'new.example.test', '--project', f.first.project.slug);
  assert.equal(bySlug.code, 0, bySlug.stderr);
  let state = JSON.parse((await f.stateBytes()).toString());
  assert.equal(state.projects.find(p => p.id === f.first.project.id).domain, 'new.example.test');
  assert.equal(state.projects.find(p => p.id === second.project.id).domain, 'second.example.test');
  const byId = await f.command('configure', '--domain', 'https://final.example.test/', '--project', second.project.id);
  assert.equal(byId.code, 0, byId.stderr);
  state = JSON.parse((await f.stateBytes()).toString());
  assert.equal(state.projects.find(p => p.id === second.project.id).domain, 'final.example.test');
});

test('invalid configure values never mutate existing state or credentials', async t => {
  const f = await fixture(t);
  const credentialsBefore = await readFile(path.join(f.dataDir, 'credentials.json'));
  const invalid = [
    [], ['--public-url', 'ftp://studio.example.test'], ['--public-url', 'studio.example.test'],
    ['--public-url', 'https://user:password@studio.example.test'], ['--public-url', 'https://studio.example.test/path'],
    ['--public-url', 'https://studio.example.test/path/..'], ['--site-url', 'https://preview.example.test?'],
    ['--site-url', 'https://preview.example.test#'], ['--site-url', 'https://preview.example.test?q=1'],
    ['--site-url', f.credentials.instance.publicUrl], ['--port', String(f.sitePort)],
    ['--port', '0'], ['--site-port', '65536'], ['--port', '2.5'], ['--port', '1e3'],
    ['--host', 'example.com'], ['--host', '127.0.0.1;echo unsafe'],
    ['--domain', 'invalid/path'], ['--domain', '-invalid.example'], ['--domain', 'https://example.test/path'],
  ];
  for (const args of invalid) {
    const before = await f.stateBytes();
    const result = await f.command('configure', ...args);
    assert.equal(result.code, 1, `Reject ${args.join(' ') || 'no settings'}`);
    assert.deepEqual(await f.stateBytes(), before, 'Validation failures must not write state');
    assert.deepEqual(await readFile(path.join(f.dataDir, 'credentials.json')), credentialsBefore);
  }
});

test('configure accepts localhost HTTP, IPv6 loopback and the full valid TCP port range', async t => {
  const f = await fixture(t);
  const state = f.store.read();
  const prepared = prepareConfiguration(state, { host: '::1', port: '1', 'site-port': '65535', 'public-url': 'http://[::1]:4310/', 'site-url': 'http://[::1]:4311/' });
  assert.equal(prepared.instance.host, '::1');
  assert.equal(prepared.instance.port, 1);
  assert.equal(prepared.instance.sitePort, 65535);
  assert.equal(prepared.instance.publicUrl, 'http://[::1]:4310');
  assert.deepEqual(f.store.read(), state, 'Preparing configuration is a pure validation step');
  const result = await f.command('configure', '--public-url', `http://127.0.0.1:${f.port}`, '--site-url', `http://127.0.0.1:${f.sitePort}`);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.data.host, state.instance.host);
  assert.equal(result.data.port, state.instance.port);
  assert.equal(result.data.sitePort, state.instance.sitePort);
});

test('configure refuses a real running instance even without a managed PID file', async t => {
  const f = await fixture(t);
  const servers = await startServers({ dataDir: f.dataDir, store: f.store });
  t.after(() => servers.close());
  const before = await f.stateBytes();
  const result = await f.command('configure', '--public-url', 'https://new-studio.example.test');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /running.*Stop/i);
  assert.deepEqual(await f.stateBytes(), before);
  const live = await fetch(`http://127.0.0.1:${f.port}/health`);
  assert.equal(live.status, 200);
  assert.equal((await live.json()).instanceId, f.credentials.instance.id);
});

test('configure refuses an unverified living PID and respects the lifecycle lock', async t => {
  const f = await fixture(t);
  const before = await f.stateBytes();
  await writeFile(path.join(f.dataDir, 'run.json'), JSON.stringify({ pid: process.pid, instanceId: 'unrelated-instance' }));
  let result = await f.command('configure', '--public-url', 'https://new-studio.example.test');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /alive.*cannot be verified.*No signal sent/);
  assert.deepEqual(await f.stateBytes(), before);
  process.kill(process.pid, 0);
  await rm(path.join(f.dataDir, 'run.json'));
  await writeFile(path.join(f.dataDir, '.control.lock'), JSON.stringify({ pid: process.pid }));
  result = await f.command('configure', '--public-url', 'https://new-studio.example.test');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /lifecycle command is running/);
  assert.deepEqual(await f.stateBytes(), before);
});

test('configure rejects a non-HTTP service occupying an old listener port', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const sockets = new Set();
  const other = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); });
  await new Promise(resolve => other.listen(f.port, '127.0.0.1', resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => other.close(resolve)); });
  const before = await f.stateBytes();
  const result = await f.command('configure', '--public-url', 'https://new-studio.example.test');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /occupied by a service/);
  assert.deepEqual(await f.stateBytes(), before);
});

test('configure rejects an occupied proposed port and leaves unrelated services running', async t => {
  const f = await fixture(t);
  const other = http.createServer((_req, res) => { res.statusCode = 404; res.end('An unrelated service'); });
  await new Promise(resolve => other.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => other.close(resolve)));
  const port = other.address().port;
  const before = await f.stateBytes();
  const result = await f.command('configure', '--port', String(port));
  assert.equal(result.code, 1);
  assert.match(result.stderr, /occupied by a service/);
  assert.deepEqual(await f.stateBytes(), before);
  assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 404);
});

test('configure is discoverable in CLI help', async () => {
  const result = await execute(process.execPath, [bin, 'configure', '--help']);
  assert.match(result.stdout, /configure\s+Change a stopped instance/);
  assert.match(result.stdout, /Configure options \(instance must be stopped\)/);
  assert.match(result.stdout, /--project ID_OR_SLUG/);
});
