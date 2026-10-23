import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { PassThrough } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { prepareSetup, validateSetupPlan, writeSetupFiles } from '../src/setup.mjs';
import { openStore } from '../src/store.mjs';
import { initializeInstance, createProject, publishPage, uploadAsset } from '../src/service.mjs';
import { exportProject } from '../src/migration.mjs';

const exec = promisify(execFile), bin = fileURLToPath(new URL('../bin/lumasite.mjs', import.meta.url));
const missing = file => assert.rejects(fs.access(file), { code: 'ENOENT' });
async function ports() {
  const servers = await Promise.all([0, 1].map(() => new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server));
  })));
  const values = servers.map(server => server.address().port);
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  return values;
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lumasite-installer-')), dataDir = path.join(root, 'data');
  const command = async (...args) => {
    try { const r = await exec(process.execPath, [bin, ...args, '--data-dir', dataDir, '--json'], { timeout: 25000, maxBuffer: 1024 * 1024 }); return { code: 0, data: JSON.parse(r.stdout) }; }
    catch (r) { return { code: r.code, error: r.stderr ? JSON.parse(r.stderr).error : r.message }; }
  };
  t.after(async () => { await command('stop'); await fs.rm(root, { recursive: true, force: true }); });
  return { root, dataDir, command };
}

test('installer validates public origins, ports, domain and project before creating data', () => {
  const base = { mode: 'server', name: 'A website', dataDir: '/tmp/setup-validation', domain: 'www.example.com', port: 4310, sitePort: 4311, publicUrl: 'https://studio.example.com', sitePublicUrl: 'https://preview.example.com' };
  const plan = validateSetupPlan(base);
  assert.equal(plan.slug, 'a-website'); assert.match(plan.proxyConfig, /ServerName www\.example\.com/);
  for (const patch of [{ publicUrl: 'https://www.example.com' }, { publicUrl: 'http://studio.example.com' }, { sitePublicUrl: base.publicUrl }, { publicUrl: 'https://studio.example.com/with-path' }, { domain: '' }, { port: 4311 }, { port: 80 }, { slug: '../other' }]) assert.throws(() => validateSetupPlan({ ...base, ...patch }));
});

test('installer starts a real instance and leaves existing data unchanged on repeat setup', { timeout: 45000 }, async t => {
  const { dataDir, command } = await fixture(t), [port, sitePort] = await ports();
  const setup = await command('setup', '--yes', '--name', 'Installed website', '--port', String(port), '--site-port', String(sitePort));
  assert.equal(setup.code, 0, setup.error); assert.equal(setup.data.healthy, true);
  assert.equal(setup.data.managed, true); assert.equal(setup.data.port, port);
  assert.match(setup.data.projects[0].mcp, new RegExp(`localhost:${port}/mcp/`));
  assert.ok(setup.data.password); assert.match(setup.data.projects[0].token, /^ls_project_/);
  assert.equal((await command('health')).code, 0);
  const page = await fetch(`http://127.0.0.1:${port}/admin`); assert.equal(page.status, 200);
  const before = await fs.readFile(path.join(dataDir, 'state.json'));
  const credentials = await fs.readFile(path.join(dataDir, 'credentials.json'));
  const repeated = await command('setup', '--yes', '--name', 'Replacement');
  assert.equal(repeated.code, 1); assert.match(repeated.error, /already exists/);
  assert.deepEqual(await fs.readFile(path.join(dataDir, 'state.json')), before);
  assert.deepEqual(await fs.readFile(path.join(dataDir, 'credentials.json')), credentials);
  const notes = await fs.readFile(setup.data.instructions, 'utf8');
  assert.match(notes, /lumasite logs --follow --data-dir/); assert.equal(notes.includes(setup.data.password), false);
  assert.equal(notes.includes(setup.data.projects[0].token), false);
  assert.equal((await fs.stat(setup.data.instructions)).mode & 0o077, 0);
});

test('server installer generates proxy files and supports explicit no-start', async t => {
  const { dataDir, command } = await fixture(t), [port, sitePort] = await ports();
  const setup = await command('setup', '--yes', '--no-start', '--mode', 'server', '--name', 'Server website', '--domain', 'example.com', '--proxy', 'caddy', '--port', String(port), '--site-port', String(sitePort));
  assert.equal(setup.code, 0, setup.error); assert.equal(setup.data.status, 'initialized');
  assert.equal(setup.data.admin, 'https://studio.example.com/admin');
  const proxy = await fs.readFile(setup.data.proxyFile, 'utf8');
  assert.match(proxy, /studio\.example\.com/); assert.match(proxy, /example\.com, preview\.example\.com/);
  assert.match(proxy, new RegExp(`127.0.0.1:${sitePort}`));
  await missing(path.join(dataDir, 'run.json'));
  const state = JSON.parse(await fs.readFile(path.join(dataDir, 'state.json')));
  assert.equal(state.instance.host, '127.0.0.1'); assert.equal(state.projects[0].domain, 'example.com');
});

function detected(proxy, networkMode) {
  return { platform: 'linux', proxies: [{ id: proxy, label: proxy, installed: !networkMode, running: true, uncertain: false, binaries: [], services: [], processes: [], publicPorts: [80, 443], containers: networkMode ? [{ name: 'edge', networkMode, image: `${proxy}:latest`, confidence: 'image', ports: '0.0.0.0:443->443/tcp' }] : [] }], ports: [80, 443].map(port => ({ port, state: 'open', owners: [], proxies: [proxy] })), checks: {}, recommendation: { proxy, requiresChoice: false, reason: `Reuse ${proxy}` } };
}

test('server wizard detects the active proxy and saves a private report and matching configuration', async t => {
  const { dataDir } = await fixture(t), [port, sitePort] = await ports();
  for (const proxy of ['apache', 'caddy', 'traefik']) {
    const directory = path.join(dataDir, proxy), report = detected(proxy);
    const plan = await prepareSetup({ yes: true, mode: 'server', name: 'Detected website', domain: 'example.com', 'data-dir': directory, port, 'site-port': sitePort, 'no-start': true }, { detect: async () => report });
    assert.equal(plan.proxy, proxy); assert.equal(plan.host, '127.0.0.1');
    assert.equal(plan.detection, report); await missing(directory);
    const files = await writeSetupFiles(plan);
    assert.equal((await fs.stat(files.detectionReport)).mode & 0o077, 0);
    assert.deepEqual(JSON.parse(await fs.readFile(files.detectionReport, 'utf8')), report);
    assert.ok((await fs.readFile(files.proxyFile, 'utf8')).includes('studio.example.com'));
    assert.match(await fs.readFile(files.instructions, 'utf8'), /lumasite detect/);
  }
});

test('automatic setup refuses ambiguous detection before writing and explicit selection bypasses detection', async t => {
  const { dataDir } = await fixture(t), [port, sitePort] = await ports();
  const options = { yes: true, mode: 'server', name: 'Explicit website', domain: 'example.com', 'data-dir': dataDir, port, 'site-port': sitePort, 'no-start': true };
  await assert.rejects(prepareSetup(options, { detect: async () => ({ recommendation: { proxy: null, requiresChoice: true, reason: 'Multiple proxies found.' } }) }), /Multiple proxies.*--proxy/);
  await missing(dataDir);
  const plan = await prepareSetup({ ...options, proxy: 'apache' }, { detect: async () => { throw new Error('Explicit override must skip detection'); } });
  assert.equal(plan.proxy, 'apache'); assert.equal(plan.detection, null);
  await missing(dataDir);
});

test('Docker detection requires a reachable backend and explicit public bind in unattended setup', async t => {
  const { dataDir } = await fixture(t), [port, sitePort] = await ports();
  const options = { yes: true, mode: 'server', name: 'Docker website', domain: 'example.com', 'data-dir': dataDir, port, 'site-port': sitePort, 'no-start': true };
  const context = { detect: async () => detected('traefik', 'edge-network') };
  await assert.rejects(prepareSetup(options, context), /containerized proxy.*--proxy-host/);
  await assert.rejects(prepareSetup({ ...options, 'proxy-host': '127.0.0.1' }, context), /loopback backend/);
  await assert.rejects(prepareSetup({ ...options, 'proxy-host': 'LOCALHOST' }, context), /loopback backend/);
  await assert.rejects(prepareSetup({ ...options, 'proxy-host': 'host.docker.internal' }, context), /explicit --host/);
  await missing(dataDir);
  const plan = await prepareSetup({ ...options, 'proxy-host': 'host.docker.internal', host: '0.0.0.0', 'traefik-entrypoint': 'https', 'traefik-cert-resolver': 'acme' }, context);
  assert.equal(plan.host, '0.0.0.0'); assert.match(plan.proxyConfig, /host\.docker\.internal/);
  assert.match(plan.proxyConfig, /certResolver: "acme"/);
  const nativeNetwork = await prepareSetup(options, { detect: async () => detected('traefik', 'host') });
  assert.equal(nativeNetwork.host, '127.0.0.1'); assert.match(nativeNetwork.proxyConfig, /127\.0\.0\.1/);
});

test('Traefik CLI setup and proxy generation preserve explicit entrypoint and certificate settings', async t => {
  const { dataDir, command } = await fixture(t), [port, sitePort] = await ports();
  const setup = await command('setup', '--yes', '--no-start', '--mode', 'server', '--name', 'Traefik website', '--domain', 'example.com', '--proxy', 'traefik', '--traefik-entrypoint', 'https', '--traefik-cert-resolver', 'acme', '--port', String(port), '--site-port', String(sitePort));
  assert.equal(setup.code, 0, setup.error); assert.match(setup.data.proxyFile, /traefik-dynamic\.yml$/);
  const proxy = await fs.readFile(setup.data.proxyFile, 'utf8');
  assert.match(proxy, /entryPoints: \["https"\]/); assert.match(proxy, /certResolver: "acme"/);
  const generated = await command('proxy', '--format', 'traefik', '--traefik-entrypoint', 'secure', '--traefik-cert-resolver', 'existing');
  assert.equal(generated.code, 0, generated.error); assert.match(generated.data.config, /entryPoints: \["secure"\]/);
  const unreachable = await command('proxy', '--format', 'traefik', '--proxy-host', '192.0.2.1');
  assert.equal(unreachable.code, 1); assert.match(unreachable.error, /loopback-only/);
  assert.equal((await fs.stat(setup.data.proxyFile)).mode & 0o077, 0);
  await missing(path.join(dataDir, 'run.json'));
});

test('detect works without an initialized project and creates no data directory', { timeout: 20000 }, async t => {
  const { dataDir, command } = await fixture(t);
  const result = await command('detect');
  assert.equal(result.code, 0, result.error);
  assert.ok(Array.isArray(result.data.proxies)); assert.equal(result.data.ports.length, 2);
  assert.equal(typeof result.data.recommendation.requiresChoice, 'boolean');
  await missing(dataDir);
});

test('installer refuses non-terminal prompts, invalid ZIPs and occupied ports without initializing', async t => {
  const { root, dataDir, command } = await fixture(t);
  assert.match((await command('setup')).error, /needs a terminal/); await missing(dataDir);
  assert.match((await command('setup', '--yes')).error, /requires --name or --file/); await missing(dataDir);
  const file = path.join(root, 'bad.zip'); await fs.writeFile(file, 'not a project ZIP');
  assert.equal((await command('setup', '--yes', '--file', file)).code, 1); await missing(dataDir);
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => listener.close(resolve)));
  const [sitePort] = await ports();
  const occupied = await command('setup', '--yes', '--name', 'Blocked', '--port', String(listener.address().port), '--site-port', String(sitePort));
  assert.match(occupied.error, /already in use/); await missing(dataDir); assert.equal(listener.listening, true);
});

test('installer selects free defaults when the usual admin port belongs to another service', async t => {
  const { dataDir } = await fixture(t);
  const listener = net.createServer();
  const ownsPort = await new Promise((resolve, reject) => {
    listener.once('error', error => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
    listener.listen(4310, '127.0.0.1', () => resolve(true));
  });
  if (ownsPort) t.after(() => new Promise(resolve => listener.close(resolve)));
  const plan = await prepareSetup({ yes: true, name: 'Available ports', 'data-dir': dataDir, 'no-start': true });
  assert.notEqual(plan.port, 4310); assert.notEqual(plan.sitePort, 4310); assert.notEqual(plan.port, plan.sitePort);
  await missing(dataDir);
});

test('installer imports published website and media with fresh credentials and clean domain links', async t => {
  const { root, dataDir, command } = await fixture(t), source = await openStore(path.join(root, 'source'));
  await initializeInstance(source, { password: 'Source-Installer-Password-123!' });
  const original = await createProject(source, { name: 'Imported example', domain: 'old.example.com' });
  const page = source.read().pages[0]; await publishPage(source, original.project.id, page.id);
  const tiny = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6PtQAAAAASUVORK5CYII=', 'base64');
  await uploadAsset(source, original.project.id, { name: 'icon.png', mime: 'image/png', data: tiny });
  const file = path.join(root, 'website.zip'); await fs.writeFile(file, (await exportProject(source, original.project.id)).buffer);
  const [port, sitePort] = await ports();
  const setup = await command('setup', '--yes', '--no-start', '--mode', 'server', '--file', file, '--domain', 'new.example.com', '--port', String(port), '--site-port', String(sitePort));
  assert.equal(setup.code, 0, setup.error);
  const state = JSON.parse(await fs.readFile(path.join(dataDir, 'state.json')));
  assert.equal(state.projects.length, 1); assert.equal(state.projects[0].name, 'Imported example');
  assert.notEqual(state.projects[0].id, original.project.id); assert.notEqual(setup.data.projects[0].token, original.token);
  assert.ok(state.pages[0].publishedRevisionId); assert.equal(state.assets.length, 1);
  assert.equal(state.projects[0].domain, 'new.example.com');
  assert.deepEqual(await fs.readFile(path.join(dataDir, 'media', state.projects[0].id, state.assets[0].filename)), tiny);
});

test('interactive installer accepts answers and can cancel or close without creating data', { timeout: 15000 }, async t => {
  const { dataDir } = await fixture(t), [port, sitePort] = await ports();
  for (const ending of ['n', 'y', 'EOF']) {
    const input = new PassThrough(), output = new PassThrough(); input.isTTY = true; output.isTTY = true;
    const steps = [
      ['Run locally', 'local'], ['Import a website ZIP', ''], ['Website name', 'Guided website'],
      ['Website domain', ''], ['Studio URL', ''], ['Preview URL', ''], ['Create this instance', ending],
    ];
    let index = 0;
    output.on('data', bytes => {
      if (!bytes.toString().includes(steps[index]?.[0])) return;
      const answer = steps[index++][1];
      setImmediate(() => answer === 'EOF' ? input.end() : input.write(`${answer}\n`));
    });
    const pending = prepareSetup({ 'data-dir': dataDir, port: String(port), 'site-port': String(sitePort), 'no-start': true }, { input, output });
    if (ending === 'EOF') await assert.rejects(pending, { code: 'SETUP_CANCELLED' });
    else { const plan = await pending; if (ending === 'n') assert.equal(plan, null); else { assert.equal(plan.name, 'Guided website'); assert.equal(plan.start, false); } }
    await missing(dataDir); input.destroy(); output.destroy();
  }
});
