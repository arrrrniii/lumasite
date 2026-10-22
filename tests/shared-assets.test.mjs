import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { get } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../src/store.mjs';
import { initializeInstance, createProject, createPage, updatePage, publishPage, getPreviewUrl } from '../src/service.mjs';
import { compilePageCss } from '../src/compiler.mjs';
import { startServers } from '../src/server.mjs';

const digest = text => createHash('sha256').update(text).digest('hex');
const assetPath = (body, extension) => `/content-assets/${digest(body)}.${extension}`;
const sharedCss = '.shared-heading { color: #2468dc; }';
const sharedJs = 'window.sharedAssetVersion = 1;';

async function unusedPorts() {
  const listeners = await Promise.all([0, 1].map(() => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  })));
  const ports = listeners.map(server => server.address().port);
  await Promise.all(listeners.map(server => new Promise(resolve => server.close(resolve))));
  return ports;
}

async function fixture(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'lumasite-shared-assets-'));
  const [port, sitePort] = await unusedPorts();
  const store = await openStore(dataDir);
  await initializeInstance(store, { password: 'Shared-assets-test-123!', host: '127.0.0.1', port, sitePort, publicUrl: `http://127.0.0.1:${port}` });
  const { project } = await createProject(store, { name: 'Shared asset tests' });
  let servers = await startServers({ dataDir, store });
  t.after(async () => {
    await servers.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  return {
    store, project, site: `http://127.0.0.1:${sitePort}`,
    async restart() { await servers.close(); servers = await startServers({ dataDir }); },
  };
}

async function newPage(f, slug, overrides = {}) {
  return createPage(f.store, f.project.id, { title: slug, slug, html: `<h1 class="shared-heading">${slug}</h1>`, css: sharedCss, js: sharedJs, ...overrides });
}

async function documentAssets(f, slug) {
  const response = await fetch(`${f.site}/sites/${f.project.slug}/${slug}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  const urls = {};
  for (const extension of ['css', 'js']) {
    const match = html.match(new RegExp(`(?:href|src)="(/content-assets/[a-f0-9]{64}\\.${extension})"`));
    assert.ok(match, `Published document contains a content-hashed ${extension} URL`);
    urls[extension] = match[1];
  }
  return urls;
}

function rawGet(url, headers) {
  // Use raw HTTP so Fetch's automatic no-cache headers do not alter the
  // conditional request being tested.
  return new Promise((resolve, reject) => {
    get(url, { headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
      response.on('error', reject);
    }).on('error', reject);
  });
}

test('published pages share byte-addressed assets, cache conditionally, and retain historical URLs', async t => {
  const f = await fixture(t);
  const one = await newPage(f, 'one');
  const two = await newPage(f, 'two');
  const first = await publishPage(f.store, f.project.id, one.id);
  await publishPage(f.store, f.project.id, two.id);
  const firstRevision = f.store.read().revisions.find(revision => revision.id === first.revision.id);
  const oneUrls = await documentAssets(f, 'one');
  const twoUrls = await documentAssets(f, 'two');
  assert.deepEqual(oneUrls, twoUrls, 'Different page revisions reuse identical CSS and JavaScript URLs');
  assert.equal(oneUrls.css, assetPath(firstRevision.compiledCss, 'css'));
  assert.equal(oneUrls.js, assetPath(sharedJs, 'js'));

  for (const [extension, body] of [['css', firstRevision.compiledCss], ['js', sharedJs]]) {
    const response = await fetch(`${f.site}${oneUrls[extension]}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), extension === 'css' ? /^text\/css/ : /javascript/);
    assert.equal(response.headers.get('cache-control'), 'public,max-age=31536000,immutable');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await response.text(), body);
    const etag = response.headers.get('etag');
    assert.equal(etag, `"sha256-${digest(body)}"`);
    const unchanged = await rawGet(`${f.site}${oneUrls[extension]}`, { 'If-None-Match': etag });
    assert.equal(unchanged.status, 304);
    assert.equal(unchanged.body, '');
    assert.equal(unchanged.headers.etag, etag);
    assert.equal(unchanged.headers['cache-control'], 'public,max-age=31536000,immutable');
    const head = await fetch(`${f.site}${oneUrls[extension]}`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  }

  await updatePage(f.store, f.project.id, one.id, { css: '.shared-heading { color: #dc4624; }', js: 'window.sharedAssetVersion = 2;' });
  const next = await publishPage(f.store, f.project.id, one.id);
  const nextRevision = f.store.read().revisions.find(revision => revision.id === next.revision.id);
  // A new asset is resolvable even when no document from its revision has been
  // requested yet, and the in-memory index already contains older revisions.
  const changedJs = assetPath(nextRevision.page.js, 'js');
  assert.equal(await (await fetch(`${f.site}${changedJs}`)).text(), nextRevision.page.js);
  const changedUrls = await documentAssets(f, 'one');
  assert.notEqual(changedUrls.css, oneUrls.css);
  assert.notEqual(changedUrls.js, oneUrls.js);
  assert.deepEqual(await documentAssets(f, 'two'), twoUrls);
  assert.equal(await (await fetch(`${f.site}${oneUrls.css}`)).text(), firstRevision.compiledCss);
  assert.equal(await (await fetch(`${f.site}${oneUrls.js}`)).text(), sharedJs);
  assert.equal(await (await fetch(`${f.site}/release-assets/${first.revision.id}.css`)).text(), firstRevision.compiledCss);
  assert.equal(await (await fetch(`${f.site}/release-assets/${first.revision.id}.js`)).text(), sharedJs);
});

test('content assets resolve after restart before any HTML is requested', async t => {
  const f = await fixture(t);
  const page = await newPage(f, 'restart');
  const published = await publishPage(f.store, f.project.id, page.id);
  const revision = f.store.read().revisions.find(item => item.id === published.revision.id);
  const css = assetPath(revision.compiledCss, 'css');
  const js = assetPath(revision.page.js, 'js');
  await f.restart();
  // These must be the first public requests to the new process: serving a page
  // first would hide a missing cold-index fallback.
  assert.equal(await (await fetch(`${f.site}${css}`)).text(), revision.compiledCss);
  assert.equal(await (await fetch(`${f.site}${js}`)).text(), revision.page.js);
  const urls = await documentAssets(f, 'restart');
  assert.deepEqual(urls, { css, js });
});

test('draft and signed preview bytes do not enter the public content index', async t => {
  const f = await fixture(t);
  const page = await newPage(f, 'private', { css: '.private-draft { color: rebeccapurple; }', js: 'window.privateDraftOnly = true;' });
  const compiledCss = await compilePageCss(page.html, page.css, page.js);
  for (const asset of [assetPath(compiledCss, 'css'), assetPath(page.js, 'js')]) {
    assert.equal((await fetch(`${f.site}${asset}`)).status, 404);
  }
  const preview = new URL(getPreviewUrl(f.store.read(), f.project.id, page.id));
  const previewHtml = await (await fetch(`${f.site}${preview.pathname}${preview.search}`)).text();
  assert.doesNotMatch(previewHtml, /content-assets/);
  for (const extension of ['css', 'js']) {
    const match = previewHtml.match(new RegExp(`(?:href|src)="(/preview-assets/[^"\\s]+\\.${extension}[^"\\s]*)"`));
    assert.ok(match, `Preview keeps its signed ${extension} URL`);
    const signed = new URL(match[1].replaceAll('&amp;', '&'), f.site);
    const response = await fetch(signed);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), extension === 'css' ? compiledCss : page.js);
    signed.search = '';
    assert.equal((await fetch(signed)).status, 403);
  }
  assert.equal((await fetch(`${f.site}${assetPath(compiledCss, 'css')}`)).status, 404);
  assert.equal((await fetch(`${f.site}${assetPath(page.js, 'js')}`)).status, 404);
});

test('content asset paths are strict and cannot be claimed by project pages', async t => {
  const f = await fixture(t);
  for (const route of ['/content-assets/not-a-hash.css', `/content-assets/${'a'.repeat(63)}.css`, `/content-assets/${'a'.repeat(64)}.mjs`, `/content-assets/${'A'.repeat(64)}.css`, `/content-assets/${'0'.repeat(64)}.js`]) {
    assert.equal((await fetch(`${f.site}${route}`)).status, 404, route);
  }
  await assert.rejects(newPage(f, 'content-assets/private'), { status: 400 });
});
