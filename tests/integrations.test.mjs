import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { openStore } from '../src/store.mjs';
import { initializeInstance, createProject, createPage, publishPage, getPreviewUrl, renderDocument } from '../src/service.mjs';
import { getIntegrations, updateIntegrations, validateIntegrations, integrationMarkup } from '../src/integrations.mjs';
import { startServers } from '../src/server.mjs';
import { exportProject, importProject } from '../src/migration.mjs';

async function port() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const value = s.address().port; await new Promise(r => s.close(r)); return value; }
async function fixture(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'lumasite-integrations-')), store = await openStore(dataDir);
  const adminPort = await port(), sitePort = await port();
  const credentials = await initializeInstance(store, { password: 'Integration-tests-123!', port: adminPort, sitePort, publicUrl: `http://127.0.0.1:${adminPort}` });
  const { project, token } = await createProject(store, { name: 'Tags', domain: 'tags.example.com' });
  const home = store.read().pages.find(p => p.projectId === project.id); await publishPage(store, project.id, home.id);
  const servers = await startServers({ store });
  t.after(async () => { await servers.close(); await rm(dataDir, { recursive: true, force: true }); });
  const get = (route, host = project.domain) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: sitePort, path: route, headers: { Host: host } }, res => { let body = ''; res.on('data', b => body += b); res.on('end', () => resolve({ status: res.statusCode, body })); }); req.on('error', reject); req.end();
  });
  return { store, project, home, token, credentials, admin: `http://127.0.0.1:${adminPort}`, get };
}

test('integration validation accepts Google meta tags and patches preserve omitted settings', () => {
  assert.deepEqual(validateIntegrations({}, true), {});
  assert.deepEqual(validateIntegrations({ googleAnalyticsId: 'G-ABC1234' }, true), { googleAnalyticsId: 'G-ABC1234' });
  assert.equal(validateIntegrations({ googleSiteVerification: '<meta name="google-site-verification" content="google_token-123">' }).googleSiteVerification, 'google_token-123');
  for (const value of [{ googleAnalyticsId: 'G-ABC<script>' }, { googleTagManagerId: 'UA-1234' }, { googleSiteVerification: '<meta name="other" content="1234">' }, { customTags: [{ name: 'bad', code: `ls_project_${'x'.repeat(45)}` }] }, { customTags: [{ name: 'large', code: 'x'.repeat(65537) }] }, { unknown: true }]) assert.throws(() => validateIntegrations(value), { status: 400 });
});

test('shared integration rendering updates existing and new blogs without changing page revisions', async t => {
  const f = await fixture(t), before = f.store.read();
  const settings = await updateIntegrations(f.store, f.project.id, { googleAnalyticsId: 'G-TEST12345', googleSiteVerification: 'verify_tags_123', trackingEnabled: true, consentMode: 'immediate', customTags: [
    { name: 'Head tag', code: '<script id="custom-head">window.headTag=true</script>', placement: 'head', requiresConsent: false },
    { name: 'Body start', code: '<script id="custom-start">window.startTag=true</script>', placement: 'bodyStart' },
    { name: 'Body end', code: '<script id="custom-end">window.endTag=true</script>', placement: 'bodyEnd' },
    { name: 'Disabled', code: '<script id="disabled-tag"></script>', enabled: false },
  ] });
  assert.equal(settings.integrations.revision, 1);
  assert.deepEqual(f.store.read().pages, before.pages); assert.deepEqual(f.store.read().revisions, before.revisions);
  let html = (await f.get('/')).body;
  assert.ok(html.indexOf('name="google-site-verification"') < html.indexOf('</head>'));
  assert.match(html, /gtag\/js\?id=G-TEST12345/); assert.match(html, /<body><script id="custom-start"/);
  assert.ok(html.indexOf('id="custom-head"') < html.indexOf('</head>'));
  assert.ok(html.indexOf('id="custom-end"') > html.indexOf('</main>')); assert.doesNotMatch(html, /disabled-tag/);
  const blog = await createPage(f.store, f.project.id, { slug: 'blog/new', title: 'New article', html: '<main><h1>New blog</h1></main>', seo: { type: 'article' } });
  await publishPage(f.store, f.project.id, blog.id);
  assert.match((await f.get('/blog/new')).body, /G-TEST12345/);
  await updateIntegrations(f.store, f.project.id, { googleSiteVerification: 'new_verification', expectedRevision: 1 });
  assert.equal(getIntegrations(f.store.read().projects[0]).googleAnalyticsId, 'G-TEST12345');
  assert.match((await f.get('/')).body, /new_verification/);
  await assert.rejects(updateIntegrations(f.store, f.project.id, { trackingEnabled: false, expectedRevision: 1 }), { status: 409 });
  const preview = new URL(getPreviewUrl(f.store.read(), f.project.id, f.home.id));
  for (const [route, host] of [[`/sites/${f.project.slug}/`, 'preview.example.com'], [preview.pathname + preview.search, '127.0.0.1']]) {
    html = (await f.get(route, host)).body;
    assert.doesNotMatch(html, /google-site-verification|googletagmanager|custom-head|lumasite-optional-tags/);
  }
  assert.doesNotMatch(renderDocument(f.home, { project: f.store.read().projects[0], preview: true, liveIntegrations: true }), /google-site-verification/);
});

test('consent-aware rendering keeps optional snippets inert while verification and essential code remain immediate', () => {
  const project = { id: 'project', integrations: validateIntegrations({ googleAnalyticsId: 'G-TEST12345', googleTagManagerId: 'GTM-TEST1234', googleSiteVerification: 'verify_123', trackingEnabled: true, customTags: [
    { name: 'Optional', code: '<script>window.optional=1</script>' }, { name: 'Essential', code: '<meta name="essential" content="yes">', requiresConsent: false },
  ] }) };
  const result = integrationMarkup(project, true);
  assert.match(result.head, /name="google-site-verification"/); assert.match(result.head, /name="essential"/);
  assert.doesNotMatch(result.head, /<script async src="https:\/\/www.googletagmanager/);
  const payload = JSON.parse(result.head.match(/id="lumasite-optional-tags">([^<]+)<\/script>/)[1]);
  assert.equal(payload.tags.length, 3); assert.equal(result.bodyStart, ''); assert.equal(result.bodyEnd, '');
  assert.doesNotMatch(result.head, /<script>window.optional/); assert.match(payload.tags[2].code, /window.optional/);
  assert.deepEqual(integrationMarkup(project, false), { head: '', bodyStart: '', bodyEnd: '' });
});

test('admin API and real MCP provide the same project-scoped integration settings', async t => {
  const f = await fixture(t), route = `/api/projects/${f.project.id}/integrations`;
  assert.equal((await fetch(f.admin + route)).status, 401);
  const headers = { Authorization: `Bearer ${f.credentials.adminToken}`, 'Content-Type': 'application/json' };
  const client = new Client({ name: 'integration-test', version: '1' }, { capabilities: {} }); t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`${f.admin}/mcp/${f.project.id}`), { requestInit: { headers: { Authorization: `Bearer ${f.token}` } } }));
  const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); assert.notEqual(r.isError, true); return r.structuredContent; };
  const first = await call('integrations_get', {}); assert.equal(first.integrations.revision, 0);
  await call('integrations_update', { googleAnalyticsId: 'G-MCP12345', trackingEnabled: true, expectedRevision: 0 });
  const read = await (await fetch(f.admin + route, { headers })).json(); assert.equal(read.integrations.googleAnalyticsId, 'G-MCP12345');
  const response = await fetch(f.admin + route, { method: 'PATCH', headers, body: JSON.stringify({ googleSiteVerification: 'api_verification', expectedRevision: 1 }) }); assert.equal(response.status, 200);
  assert.equal((await call('integrations_get', {})).integrations.googleSiteVerification, 'api_verification');
  await call('integrations_update', { googleSiteVerification: '<meta name="google-site-verification" content="mcp_complete_meta">', expectedRevision: 2, customTags: [{ name: 'First', code: '<script>window.first=1</script>' }, { name: 'Second', code: '<script>window.second=1</script>' }] });
  const updated = (await call('integrations_get', {})).integrations;
  assert.equal(updated.googleSiteVerification, 'mcp_complete_meta'); assert.notEqual(updated.customTags[0].id, updated.customTags[1].id);
  assert.equal((await fetch(f.admin + route, { method: 'PATCH', headers, body: JSON.stringify({ googleAnalyticsId: 'invalid' }) })).status, 400);
  const other = (await createProject(f.store, { name: 'Other' })).project;
  assert.equal(getIntegrations(other).googleAnalyticsId, '');
});

test('ZIP creation disables copied tracking and verification; updates retain destination integrations', async t => {
  const f = await fixture(t);
  await updateIntegrations(f.store, f.project.id, { trackingEnabled: true, googleAnalyticsId: 'G-SOURCE123', googleSiteVerification: 'source_token', customTags: [{ name: 'Source tag', code: '<script>window.source=1</script>' }] });
  const archive = await exportProject(f.store, f.project.id);
  const copy = await importProject(f.store, archive.buffer, { slug: 'imported', domain: 'imported.example.com' });
  const imported = getIntegrations(copy.project);
  assert.equal(imported.googleAnalyticsId, 'G-SOURCE123'); assert.equal(imported.trackingEnabled, false); assert.equal(imported.googleSiteVerification, ''); assert.equal(imported.customTags[0].enabled, false);
  await updateIntegrations(f.store, copy.project.id, { googleAnalyticsId: 'G-DEST1234', googleSiteVerification: 'destination_token', trackingEnabled: true, expectedRevision: 0 });
  await importProject(f.store, archive.buffer, { mode: 'update', projectId: copy.project.id, confirmSlug: 'imported' });
  const current = getIntegrations(f.store.read().projects.find(p => p.id === copy.project.id));
  assert.equal(current.googleAnalyticsId, 'G-DEST1234'); assert.equal(current.googleSiteVerification, 'destination_token'); assert.equal(current.trackingEnabled, true);
});
