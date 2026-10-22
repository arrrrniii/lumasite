import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store.mjs';
import { initializeInstance, createProject, updatePage, createPage, publishPage, uploadAsset } from '../src/service.mjs';
import { startServers } from '../src/server.mjs';

const execute = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/lumasite.mjs', import.meta.url));
async function freePorts() {
  const listeners = await Promise.all([0, 1].map(() => new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => resolve(listener));
  })));
  const ports = listeners.map(listener => listener.address().port);
  await Promise.all(listeners.map(listener => new Promise(resolve => listener.close(resolve))));
  return ports;
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lumasite-migration-cli-'));
  const servers = [];
  t.after(async () => { for (const server of servers) await server.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const command = async (dataDir, ...args) => {
    try {
      const result = await execute(process.execPath, [bin, ...args, '--data-dir', dataDir, '--json'], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
      return { code: 0, ...result, data: JSON.parse(result.stdout) };
    } catch (error) { return { code: error.code, stdout: error.stdout || '', stderr: error.stderr || '' }; }
  };
  const instance = async name => {
    const dataDir = path.join(directory, name);
    const [port, sitePort] = await freePorts();
    const store = await openStore(dataDir);
    const credentials = await initializeInstance(store, { password: 'Portable-CLI-Example-123!', host: '127.0.0.1', port, sitePort });
    return { dataDir, store, port, sitePort, credentials };
  };
  const source = await instance('source');
  const created = await createProject(source.store, { name: 'Portable Site', slug: 'portable', domain: 'source.example.test' });
  const project = created.project;
  const asset = await uploadAsset(source.store, project.id, { name: 'original.png', mime: 'image/png', data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6PtQAAAAASUVORK5CYII=', 'base64') });
  const home = source.store.read().pages.find(page => page.projectId === project.id);
  await updatePage(source.store, project.id, home.id, { revision: home.revision, html: `<main><h1>Portable home</h1><a href="/sites/portable/about">About</a><img src="${asset.url}" alt="Original"></main>`, css: '.portable{color:blue}', js: 'window.portable=true;' });
  await publishPage(source.store, project.id, home.id);
  const about = await createPage(source.store, project.id, { title: 'Portable About', slug: 'about', html: '<main><h1>Portable about</h1></main>', css: 'h1{color:blue}' });
  await publishPage(source.store, project.id, about.id);
  const target = await instance('target');
  return { directory, servers, command, source, target, project, projectToken: created.token, asset };
}

function noSecrets(output, f, importedToken) {
  for (const secret of [f.source.credentials.password, f.source.credentials.adminToken, f.target.credentials.adminToken, f.projectToken, importedToken].filter(Boolean)) {
    assert.equal(output.includes(secret), false, 'Migration output must not reveal credentials');
  }
}

test('CLI exports a stopped project and imports it with new IDs, private credentials and clean-domain links', { timeout: 45000 }, async t => {
  const f = await fixture(t);
  const zip = path.join(f.directory, 'portable.zip');
  const exported = await f.command(f.source.dataDir, 'export', '--project', f.project.slug, '--output', zip);
  assert.equal(exported.code, 0, exported.stderr);
  assert.equal(exported.data.containsCredentials, false);
  assert.equal((await fs.stat(zip)).mode & 0o077, 0);
  const originalArchive = await fs.readFile(zip);
  assert.equal(originalArchive.subarray(0, 2).toString(), 'PK');
  const repeated = await f.command(f.source.dataDir, 'export', '--project', f.project.id, '--output', zip);
  assert.equal(repeated.code, 1);
  assert.match(repeated.stderr, /already exists/);
  assert.deepEqual(await fs.readFile(zip), originalArchive, 'Existing ZIP must never be truncated');

  const beforeCredentials = JSON.parse(await fs.readFile(path.join(f.target.dataDir, 'credentials.json'), 'utf8'));
  const imported = await f.command(f.target.dataDir, 'import', '--file', zip, '--name', 'Production Site', '--slug', 'production-site', '--domain', 'www.example.test', '--link-mode', 'domain');
  assert.equal(imported.code, 0, imported.stderr);
  assert.equal(imported.data.status, 'imported');
  assert.equal(imported.data.pages, 2);
  assert.equal(imported.data.assets, 1);
  assert.equal(imported.data.revisions, 2);
  const importedProject = imported.data.projects[0];
  assert.notEqual(importedProject.id, f.project.id);
  assert.equal(importedProject.name, 'Production Site');
  assert.equal(importedProject.production, 'https://www.example.test/');
  assert.match(importedProject.mcp, new RegExp(`/mcp/${importedProject.id}$`));
  const state = (await openStore(f.target.dataDir)).read();
  assert.equal(state.projects[0].domain, 'www.example.test');
  const importedHome = state.pages.find(page => page.slug === '');
  assert.match(importedHome.html, /href="\/about"/);
  assert.equal(importedHome.html.includes(`/media/${f.project.id}/`), false);
  const newAsset = state.assets[0];
  assert.deepEqual(await fs.readFile(path.join(f.target.dataDir, 'media', newAsset.projectId, newAsset.filename)), await fs.readFile(path.join(f.source.dataDir, 'media', f.asset.projectId, f.asset.filename)));
  const afterCredentials = JSON.parse(await fs.readFile(path.join(f.target.dataDir, 'credentials.json'), 'utf8'));
  assert.equal(afterCredentials.adminToken, beforeCredentials.adminToken);
  assert.equal(afterCredentials.adminPassword, beforeCredentials.adminPassword);
  assert.ok(afterCredentials.projectTokens[importedProject.id]);
  assert.notEqual(afterCredentials.projectTokens[importedProject.id], f.projectToken);
  noSecrets(exported.stdout + imported.stdout, f, afterCredentials.projectTokens[importedProject.id]);
  assert.equal((await fs.stat(path.join(f.target.dataDir, 'credentials.json'))).mode & 0o077, 0);

  const before = await fs.readFile(path.join(f.target.dataDir, 'state.json'));
  const collision = await f.command(f.target.dataDir, 'import', '--file', zip, '--slug', 'production-site');
  assert.equal(collision.code, 1);
  assert.deepEqual(await fs.readFile(path.join(f.target.dataDir, 'state.json')), before);
});

test('CLI migrations use the running administrator API and the imported project is immediately live', { timeout: 45000 }, async t => {
  const f = await fixture(t);
  f.servers.push(await startServers({ dataDir: f.source.dataDir, store: f.source.store }));
  f.servers.push(await startServers({ dataDir: f.target.dataDir, store: f.target.store }));
  const zip = path.join(f.directory, 'live.zip');
  const exported = await f.command(f.source.dataDir, 'export', '--project', f.project.id, '--output', zip);
  assert.equal(exported.code, 0, exported.stderr);
  const imported = await f.command(f.target.dataDir, 'import', '--file', zip);
  assert.equal(imported.code, 0, imported.stderr);
  const response = await fetch(`http://127.0.0.1:${f.target.port}/api/projects`, { headers: { Authorization: `Bearer ${f.target.credentials.adminToken}` } });
  const { projects } = await response.json();
  assert.equal(projects.length, 1, 'Live API must see the imported project without a restart');
  assert.equal(projects[0].id, imported.data.projects[0].id);
  assert.equal(projects[0].domain, '', 'Source domain is not carried to the destination by default');
  const publicPage = await fetch(`http://127.0.0.1:${f.target.sitePort}/sites/${projects[0].slug}/`);
  assert.equal(publicPage.status, 200);
  const html = await publicPage.text();
  assert.match(html, /Portable home/);
  assert.match(html, new RegExp(`href="/sites/${projects[0].slug}/about"`));
  const token = JSON.parse(await fs.readFile(path.join(f.target.dataDir, 'credentials.json'), 'utf8')).projectTokens[projects[0].id];
  noSecrets(exported.stdout + imported.stdout, f, token);

  const credentialsFile = path.join(f.target.dataDir, 'credentials.json');
  const validCredentials = await fs.readFile(credentialsFile);
  const before = await fs.readFile(path.join(f.target.dataDir, 'state.json'));
  await fs.writeFile(credentialsFile, JSON.stringify({ ...JSON.parse(validCredentials.toString()), adminToken: 'invalid-local-admin-token' }));
  try {
    const rejected = await f.command(f.target.dataDir, 'import', '--file', zip, '--slug', 'must-not-be-created');
    assert.equal(rejected.code, 1);
    assert.match(rejected.stderr, /Sign in/);
    assert.deepEqual(await fs.readFile(path.join(f.target.dataDir, 'state.json')), before, 'API authentication failure must not fall back to an offline mutation');
    assert.equal(f.target.store.read().projects.length, 1);
  } finally { await fs.writeFile(credentialsFile, validCredentials); }
});

test('CLI refuses unverified live processes, occupied listeners, malformed ZIPs and active lifecycle locks', { timeout: 45000 }, async t => {
  const f = await fixture(t);
  const zip = path.join(f.directory, 'valid.zip');
  assert.equal((await f.command(f.source.dataDir, 'export', '--project', f.project.slug, '--output', zip)).code, 0);
  const before = await fs.readFile(path.join(f.target.dataDir, 'state.json'));
  const missingDomain = await f.command(f.target.dataDir, 'import', '--file', zip, '--link-mode', 'domain');
  assert.equal(missingDomain.code, 1);
  assert.match(missingDomain.stderr, /requires --domain/);
  const runFile = path.join(f.target.dataDir, 'run.json');
  await fs.writeFile(runFile, JSON.stringify({ pid: process.pid, instanceId: 'unverified' }));
  let result = await f.command(f.target.dataDir, 'import', '--file', zip);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /alive.*cannot be verified.*No signal sent/);
  process.kill(process.pid, 0);
  await fs.rm(runFile);

  const other = http.createServer((_req, res) => { res.statusCode = 404; res.end('Another service'); });
  await new Promise(resolve => other.listen(f.target.port, '127.0.0.1', resolve));
  try {
    result = await f.command(f.target.dataDir, 'import', '--file', zip);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /occupied/);
    assert.equal((await fetch(`http://127.0.0.1:${f.target.port}/`)).status, 404);
  } finally { await new Promise(resolve => other.close(resolve)); }

  await fs.writeFile(path.join(f.target.dataDir, '.control.lock'), JSON.stringify({ pid: process.pid }));
  result = await f.command(f.target.dataDir, 'import', '--file', zip);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /lifecycle command is running/);
  await fs.rm(path.join(f.target.dataDir, '.control.lock'));
  const invalid = path.join(f.directory, 'invalid.zip');
  await fs.writeFile(invalid, 'not a project archive');
  assert.equal((await f.command(f.target.dataDir, 'import', '--file', invalid)).code, 1);
  assert.deepEqual(await fs.readFile(path.join(f.target.dataDir, 'state.json')), before);
  const failedOutput = path.join(f.directory, 'missing-project.zip');
  result = await f.command(f.source.dataDir, 'export', '--project', 'missing', '--output', failedOutput);
  assert.equal(result.code, 1);
  await assert.rejects(fs.access(failedOutput), 'Failed export should remove only its own incomplete file');
});
