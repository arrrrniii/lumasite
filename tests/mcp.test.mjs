import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { openStore } from '../src/store.mjs';
import { initializeInstance, createProject } from '../src/service.mjs';
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
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'lumasite-mcp-'));
  const [port, sitePort] = await unusedPorts();
  const store = await openStore(dataDir);
  const credentials = await initializeInstance(store, { password: 'MCP-Integration-Password!', host: '127.0.0.1', port, sitePort, publicUrl: `http://127.0.0.1:${port}` });
  const one = await createProject(store, { name: 'MCP One', domain: 'mcp-one.example.test' });
  const two = await createProject(store, { name: 'MCP Two', domain: 'mcp-two.example.test' });
  let servers;
  const clients = [];
  t.after(async () => {
    await Promise.allSettled(clients.map(client => client.close()));
    if (servers) await servers.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  servers = await startServers({ dataDir, store });
  const admin = `http://127.0.0.1:${servers.ports.admin}`;
  const site = `http://127.0.0.1:${servers.ports.site}`;
  async function connect(project, token) {
    const client = new Client({ name: 'lumasite-integration-test', version: '1.0.0' }, { capabilities: {} });
    clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL(`/mcp/${project.id}`, admin), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    return client;
  }
  async function initializeResponse(project, token) {
    return fetch(`${admin}/mcp/${project.id}`, {
      method: 'POST',
      headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'auth-test', version: '1.0.0' } } }),
    });
  }
  return { admin, site, store, credentials, one, two, connect, initializeResponse };
}
function value(result) {
  assert.notEqual(result.isError, true, JSON.stringify(result));
  if (result.structuredContent) return result.structuredContent;
  const content = result.content.find(item => item.type === 'text');
  assert.ok(content, 'MCP tool provides structured data or JSON text');
  return JSON.parse(content.text);
}
function siteAddress(site, url) {
  const parsed = new URL(url, site);
  return `${site}${parsed.pathname}${parsed.search}`;
}

test('MCP Streamable HTTP: real SDK authoring, publish, project scope and token rotation', async t => {
  const f = await fixture(t);
  let client, page;

  await t.test('requires a project token and rejects tokens from another project', async () => {
    for (const token of [undefined, 'invalid-token', f.two.token, f.credentials.adminToken]) {
      const response = await f.initializeResponse(f.one.project, token);
      assert.ok([401, 403].includes(response.status), `MCP rejects ${token === undefined ? 'missing credentials' : 'wrong credentials'}`);
      await response.body?.cancel();
    }
    client = await f.connect(f.one.project, f.one.token);
    const listed = await client.listTools();
    const names = new Set(listed.tools.map(tool => tool.name));
    for (const name of ['project_get', 'project_update', 'pages_list', 'page_get', 'page_upsert', 'page_publish', 'page_restore', 'assets_list', 'asset_upload', 'library_list', 'preview_url', 'health']) {
      assert.ok(names.has(name), `MCP exposes ${name}`);
    }
    const info = value(await client.callTool({ name: 'project_get', arguments: {} }));
    assert.equal(info.project.id, f.one.project.id);
    assert.equal(info.project.tokenHash, undefined);
  });

  await t.test('creates and reads a full source page, lists it and returns native library recipes', async () => {
    const created = value(await client.callTool({ name: 'page_upsert', arguments: {
      title: 'MCP authored page', slug: 'mcp-page', description: 'Written using the official MCP SDK',
      html: '<section class="bg-cyan-500 p-8" data-fx="border-beam"><h1>MCP version one</h1></section>',
      css: '.mcp-proof { letter-spacing: .1em; }', js: 'window.MCP_PROOF = "version-one";',
    } }));
    page = created.page;
    assert.ok(page.id);
    assert.equal(page.slug, 'mcp-page');
    const listed = value(await client.callTool({ name: 'pages_list', arguments: {} }));
    assert.ok(listed.pages.some(item => item.id === page.id));
    assert.ok(listed.pages.every(item => item.projectId === f.one.project.id));
    const fetched = value(await client.callTool({ name: 'page_get', arguments: { pageId: page.id } }));
    assert.equal(fetched.page.html, page.html);
    assert.equal(fetched.page.css, page.css);
    assert.equal(fetched.page.js, page.js);
    const library = value(await client.callTool({ name: 'library_list', arguments: {} }));
    assert.equal(library.lumafx.version, '0.5.0');
    assert.ok(library.animations.some(animation => animation.id === 'border-beam' && animation.html.includes('data-fx="border-beam"')));
    const health = value(await client.callTool({ name: 'health', arguments: {} }));
    assert.ok(health.status || health.checks || health.port, 'MCP health returns operational data');
  });

  await t.test('publishes via MCP without restarting and keeps further edits in draft', async () => {
    const before = await (await fetch(`${f.admin}/health`)).json();
    const published = value(await client.callTool({ name: 'page_publish', arguments: { pageId: page.id } }));
    assert.ok(published.revision.id);
    const live = await fetch(siteAddress(f.site, published.url));
    assert.equal(live.status, 200);
    assert.match(await live.text(), /MCP version one/);
    const updated = value(await client.callTool({ name: 'page_upsert', arguments: {
      pageId: page.id, revision: page.revision, html: '<h1 data-fx="text-reveal">MCP private version two</h1>',
      css: '.mcp-proof { color: coral; }', js: 'window.MCP_PROOF = "private-version-two";',
    } }));
    page = updated.page;
    assert.match(page.html, /private version two/);
    const unchanged = await (await fetch(siteAddress(f.site, published.url))).text();
    assert.match(unchanged, /MCP version one/);
    assert.doesNotMatch(unchanged, /MCP private version two/);
    const preview = value(await client.callTool({ name: 'preview_url', arguments: { pageId: page.id } }));
    const draft = await fetch(siteAddress(f.site, preview.url));
    assert.equal(draft.status, 200);
    assert.match(await draft.text(), /MCP private version two/);
    const after = await (await fetch(`${f.admin}/health`)).json();
    assert.equal(after.pid, before.pid);
    assert.equal(after.instanceId, before.instanceId);
  });

  await t.test('denies cross-project page IDs even through an authenticated SDK session', async () => {
    const otherPage = f.store.read().pages.find(item => item.projectId === f.two.project.id);
    assert.ok(otherPage);
    const denied = await client.callTool({ name: 'page_get', arguments: { pageId: otherPage.id } });
    assert.equal(denied.isError, true);
    assert.doesNotMatch(JSON.stringify(denied), /ls_project_/);
    const hidden = value(await client.callTool({ name: 'pages_list', arguments: {} }));
    assert.equal(hidden.pages.some(item => item.id === otherPage.id), false);
  });

  await t.test('rotation revokes the old project token and allows a new SDK connection', async () => {
    await client.close();
    const response = await fetch(`${f.admin}/api/projects/${f.one.project.id}/token`, {
      method: 'POST', headers: { authorization: `Bearer ${f.credentials.adminToken}`, 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(response.status, 200);
    const { token } = await response.json();
    assert.match(token, /^ls_project_/);
    assert.notEqual(token, f.one.token);
    const revoked = await f.initializeResponse(f.one.project, f.one.token);
    assert.ok([401, 403].includes(revoked.status));
    await revoked.body?.cancel();
    const next = await f.connect(f.one.project, token);
    const list = value(await next.callTool({ name: 'pages_list', arguments: {} }));
    assert.ok(list.pages.some(item => item.id === page.id));
    const wrongProject = await f.initializeResponse(f.two.project, token);
    assert.ok([401, 403].includes(wrongProject.status));
    await wrongProject.body?.cancel();
  });
});
