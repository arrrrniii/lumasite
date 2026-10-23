import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { openStore } from '../src/store.mjs';
import { initializeInstance } from '../src/service.mjs';
import { startServers } from '../src/server.mjs';

async function unusedPorts() {
  const listeners = await Promise.all([0, 1].map(() => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  })));
  const ports = listeners.map(server => server.address().port);
  await Promise.all(listeners.map(server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
  return ports;
}
async function fixture(t) {
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'lumasite-api-'));
  const dataDir = path.join(fixtureDir, '.lumasite');
  const [port, sitePort] = await unusedPorts();
  const store = await openStore(dataDir);
  const credentials = await initializeInstance(store, {
    password: 'Integration-Password-123!', host: '127.0.0.1', port, sitePort,
    publicUrl: `http://127.0.0.1:${port}`,
  });
  let servers;
  t.after(async () => {
    if (servers) await servers.close();
    await rm(fixtureDir, { recursive: true, force: true });
  });
  servers = await startServers({ dataDir, store });
  const admin = `http://127.0.0.1:${servers.ports.admin}`;
  const site = `http://127.0.0.1:${servers.ports.site}`;
  const auth = { authorization: `Bearer ${credentials.adminToken}` };
  async function request(route, { method = 'GET', body, headers = {}, raw = false, authenticated = true } = {}) {
    if (body === undefined && method !== 'GET' && method !== 'HEAD') body = {};
    const response = await fetch(`${admin}${route}`, {
      method, headers: { ...(authenticated ? auth : {}), ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { response, data };
  }
  return { admin, site, auth, request, credentials, store };
}
function atSite(site, url) {
  const parsed = new URL(url, site);
  return `${site}${parsed.pathname}${parsed.search}`;
}
function extractAsset(html, extension) {
  const match = html.match(new RegExp(`(?:href|src)="((?:/preview-assets/|/release-assets/|/content-assets/)[^"\\s]+\\.${extension}(?:\\?[^"\\s]*)?)"`));
  assert.ok(match, `Document contains a ${extension} asset URL`);
  return match[1];
}

test('HTTP authoring: authentication, immutable publishing, revisions, media and native runtime', async t => {
  const f = await fixture(t);
  let project, page, firstRevision, livePath;

  await t.test('reports setup and health; protects APIs; supports session login and logout', async () => {
    const setup = await f.request('/api/setup', { authenticated: false });
    assert.equal(setup.response.status, 200);
    assert.equal(setup.data.configured, true);
    const health = await fetch(`${f.admin}/health`);
    const data = await health.json();
    assert.equal(data.status, 'ok');
    assert.equal(data.pid, process.pid);
    assert.equal(data.port, Number(new URL(f.admin).port));
    assert.equal(data.sitePort, Number(new URL(f.site).port));
    assert.equal((await fetch(`${f.admin}/ready`)).status, 200);
    assert.equal((await f.request('/api/projects', { authenticated: false })).response.status, 401);
    assert.equal((await f.request('/api/login', { method: 'POST', body: { password: 'incorrect-password' }, authenticated: false })).response.status, 401);
    const login = await f.request('/api/login', { method: 'POST', body: { password: f.credentials.password }, authenticated: false });
    assert.equal(login.response.status, 200);
    const setCookie = login.response.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/i);
    const cookie = setCookie.split(';')[0];
    const session = await f.request('/api/session', { headers: { cookie }, authenticated: false });
    assert.equal(session.response.status, 200);
    assert.equal(session.data.authenticated, true);
    const logout = await f.request('/api/logout', { method: 'POST', headers: { cookie }, authenticated: false });
    assert.equal(logout.response.status, 200);
    assert.match(logout.response.headers.get('set-cookie'), /(?:Max-Age=0|Expires=Thu, 01 Jan 1970)/i);
    const setupAgain = await f.request('/api/setup', { method: 'POST', body: { password: 'Another-Password-123!' }, authenticated: false });
    assert.ok([403, 409].includes(setupAgain.response.status), 'Initialized setup cannot be claimed again');
  });

  await t.test('creates a project with usable admin/MCP/site URLs and private token', async () => {
    const result = await f.request('/api/projects', { method: 'POST', body: { name: 'Integration One', domain: 'one.example.test' } });
    assert.ok([200, 201].includes(result.response.status));
    project = result.data.project;
    assert.equal(project.name, 'Integration One');
    assert.equal(project.domain, 'one.example.test');
    assert.equal(project.tokenHash, undefined);
    assert.match(result.data.token, /^ls_project_/);
    assert.equal(new URL(result.data.urls.mcp).pathname, `/mcp/${project.id}`);
    assert.equal(new URL(result.data.urls.admin).pathname, `/admin/projects/${project.id}`);
    assert.equal(result.data.urls.production, 'https://one.example.test/');
    const list = await f.request('/api/projects');
    assert.equal(list.data.projects.length, 1);
    assert.equal(list.data.projects[0].token, undefined);
    assert.equal(list.data.projects[0].tokenHash, undefined);
    const scoped = await f.request('/api/projects', { authenticated: false, headers: { authorization: `Bearer ${result.data.token}` } });
    assert.ok([401, 403].includes(scoped.response.status), 'A project token does not authorize admin APIs');
    const diagnostics = await f.request('/api/diagnostics');
    assert.equal(diagnostics.response.status, 200);
    assert.equal(diagnostics.data.cliPath, path.resolve('bin/lumasite.mjs'));
    assert.equal(JSON.stringify(diagnostics.data).includes(f.credentials.adminToken), false);
  });

  await t.test('creates a private draft and protects signed preview plus preview assets', async () => {
    const created = await f.request(`/api/projects/${project.id}/pages`, { method: 'POST', body: {
      title: '<Luma test>', slug: 'launch', description: 'Editable page integration test',
      html: '<main class="bg-violet-600 p-10"><h1 data-fx="text-reveal">Published version one</h1><button data-fx="press">Explore</button></main>',
      css: '.custom-proof { color: rebeccapurple; }',
      js: 'window.LUMA_TEST = "published-v1";',
    } });
    assert.ok([200, 201].includes(created.response.status));
    page = created.data.page;
    livePath = `/sites/${project.slug}/launch`;
    assert.equal((await fetch(`${f.site}${livePath}`)).status, 404);
    const unauthorized = await fetch(`${f.site}/preview/${project.id}/${page.id}`);
    assert.ok([401, 403, 404].includes(unauthorized.status));
    const preview = await f.request(`/api/projects/${project.id}/preview`, { method: 'POST', body: { pageId: page.id } });
    assert.equal(preview.response.status, 200);
    const previewResponse = await fetch(atSite(f.site, preview.data.url));
    assert.equal(previewResponse.status, 200);
    const html = await previewResponse.text();
    assert.match(html, /Published version one/);
    assert.match(html, /noindex/);
    const jsUrl = extractAsset(html, 'js');
    assert.match(await (await fetch(atSite(f.site, jsUrl))).text(), /published-v1/);
    const stripped = new URL(jsUrl, f.site);
    stripped.search = '';
    const privateAsset = await fetch(`${f.site}${stripped.pathname}`);
    assert.ok([401, 403, 404].includes(privateAsset.status), 'Draft assets cannot be fetched without authorization');
  });

  await t.test('publishes full HTML/CSS/JS and serves actual LumaFX without restarting', async () => {
    const before = await (await fetch(`${f.admin}/health`)).json();
    const published = await f.request(`/api/projects/${project.id}/pages/${page.id}/publish`, { method: 'POST' });
    assert.equal(published.response.status, 200);
    firstRevision = published.data.revision;
    assert.ok(firstRevision.id);
    const live = await fetch(`${f.site}${livePath}`);
    assert.equal(live.status, 200);
    assert.match(live.headers.get('content-type'), /text\/html/);
    const html = await live.text();
    assert.match(html, /Published version one/);
    assert.match(html, /<title>&lt;Luma test&gt;<\/title>/);
    assert.match(html, /\/runtime\/lumafx\/lumafx\.css/);
    assert.match(html, /\/runtime\/lumafx\/lumafx\.global\.js/);
    const css = await (await fetch(atSite(f.site, extractAsset(html, 'css')))).text();
    assert.match(css, /\.bg-violet-600/);
    assert.match(css, /\.custom-proof/);
    assert.match(css, /rebeccapurple/);
    const js = await (await fetch(atSite(f.site, extractAsset(html, 'js')))).text();
    assert.match(js, /published-v1/);
    const runtime = await fetch(`${f.site}/runtime/lumafx/lumafx.global.js`);
    assert.equal(runtime.status, 200);
    assert.match(runtime.headers.get('content-type'), /javascript/);
    assert.ok((await runtime.text()).length > 100000, 'Vendored LumaFX is the real distribution');
    const nativeCss = await fetch(`${f.site}/runtime/lumafx/lumafx.css`);
    assert.equal(nativeCss.status, 200);
    assert.match(await nativeCss.text(), /border-beam/);
    const library = await f.request('/api/library');
    assert.equal(library.data.lumafx.version, '0.5.0');
    assert.ok(library.data.animations.some(a => a.id === 'text-reveal'));
    const after = await (await fetch(`${f.admin}/health`)).json();
    assert.equal(after.pid, before.pid);
    assert.equal(after.instanceId, before.instanceId);
  });

  await t.test('draft changes preserve live snapshots and reject stale revisions', async () => {
    const update = await f.request(`/api/projects/${project.id}/pages/${page.id}`, { method: 'PUT', body: {
      revision: page.revision,
      html: '<h1 class="bg-emerald-500">Private version two</h1>', css: '.version-two { color: tomato; }', js: 'window.LUMA_TEST = "draft-v2";',
    } });
    assert.equal(update.response.status, 200);
    const originalRevision = page.revision;
    page = update.data.page;
    assert.equal(page.revision, originalRevision + 1);
    const stale = await f.request(`/api/projects/${project.id}/pages/${page.id}`, { method: 'PUT', body: { revision: originalRevision, html: 'stale overwrite' } });
    assert.equal(stale.response.status, 409);
    const live = await (await fetch(`${f.site}${livePath}`)).text();
    assert.match(live, /Published version one/);
    assert.doesNotMatch(live, /Private version two|stale overwrite/);
    assert.match(await (await fetch(atSite(f.site, extractAsset(live, 'js')))).text(), /published-v1/);
    const next = await f.request(`/api/projects/${project.id}/pages/${page.id}/publish`, { method: 'POST' });
    assert.equal(next.response.status, 200);
    assert.notEqual(next.data.revision.id, firstRevision.id);
    const updated = await (await fetch(`${f.site}${livePath}`)).text();
    assert.match(updated, /Private version two/);
    assert.match(await (await fetch(atSite(f.site, extractAsset(updated, 'js')))).text(), /draft-v2/);
    // Immutable assets from the first publish still resolve after another publish.
    assert.match(await (await fetch(atSite(f.site, extractAsset(live, 'js')))).text(), /published-v1/);
  });

  await t.test('restores a previous revision to a draft and only replaces live on publish', async () => {
    const revisions = await f.request(`/api/projects/${project.id}/pages/${page.id}/revisions`);
    assert.equal(revisions.response.status, 200);
    assert.equal(revisions.data.revisions.length, 2);
    const restored = await f.request(`/api/projects/${project.id}/pages/${page.id}/restore`, { method: 'POST', body: { revisionId: firstRevision.id } });
    assert.equal(restored.response.status, 200);
    assert.match(restored.data.page.html, /Published version one/);
    assert.match(await (await fetch(`${f.site}${livePath}`)).text(), /Private version two/);
    const republished = await f.request(`/api/projects/${project.id}/pages/${page.id}/publish`, { method: 'POST' });
    assert.equal(republished.response.status, 200);
    assert.match(await (await fetch(`${f.site}${livePath}`)).text(), /Published version one/);
  });

  await t.test('stores media and supports HTTP ranges on the public listener', async () => {
    const bytes = Buffer.alloc(52);
    bytes.write('RIFF', 0); bytes.writeUInt32LE(44, 4); bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36); bytes.writeUInt32LE(8, 40);
    const uploaded = await f.request(`/api/projects/${project.id}/assets`, { method: 'POST', raw: true, body: bytes, headers: { 'content-type': 'audio/wav', 'x-filename': encodeURIComponent('A short note.wav') } });
    assert.ok([200, 201].includes(uploaded.response.status));
    const asset = uploaded.data.asset;
    assert.equal(asset.name, 'A short note.wav');
    assert.equal(asset.size, bytes.length);
    const full = await fetch(atSite(f.site, asset.url));
    assert.equal(full.status, 200);
    assert.match(full.headers.get('content-type'), /audio\/wav/);
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
    const range = await fetch(atSite(f.site, asset.url), { headers: { range: 'bytes=0-11' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-range'), `bytes 0-11/${bytes.length}`);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 12));
    const listing = await f.request(`/api/projects/${project.id}/assets`);
    assert.ok(listing.data.assets.some(item => item.id === asset.id));
  });

  await t.test('serves self-hosted fonts to opaque-origin sandboxed previews', async () => {
    const bytes = await readFile(new URL('../marketing/assets/fonts/soravariable.woff2', import.meta.url));
    const uploaded = await f.request(`/api/projects/${project.id}/assets`, { method: 'POST', raw: true, body: bytes, headers: { 'content-type': 'font/woff2', 'x-filename': 'Sora.woff2' } });
    assert.equal(uploaded.response.status, 201);
    const font = await fetch(atSite(f.site, uploaded.data.asset.url), { headers: { Origin: 'null' } });
    assert.equal(font.status, 200);
    assert.equal(font.headers.get('access-control-allow-origin'), '*');
    assert.match(font.headers.get('content-type'), /font\/woff2/);
    assert.deepEqual(Buffer.from(await font.arrayBuffer()), bytes);
  });

  await t.test('keeps administration and APIs off the public website listener', async () => {
    for (const route of ['/api/projects', '/api/session', '/admin', `/mcp/${project.id}`]) {
      const response = await fetch(`${f.site}${route}`);
      assert.equal(response.status, 404, `Public listener rejects ${route}`);
    }
  });
});
