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
import { prepareSetup, validateSetupPlan } from '../src/setup.mjs';
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
