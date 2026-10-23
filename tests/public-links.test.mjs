import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { projectRootPath, productionLink, productionNavigation } from '../src/public-links.mjs';
import { openStore } from '../src/store.mjs';
import { initializeInstance, createProject, updatePage, createPage, publishPage, getPreviewUrl } from '../src/service.mjs';
import { startServers } from '../src/server.mjs';

const project = { slug: 'sendmailos-live', domain: 'mail.example.com' };
const instance = { sitePublicUrl: 'https://preview.example.com' };
const prefix = '/sites/sendmailos-live';

test('production links remove only this project prefix and preserve queries and fragments', () => {
  for (const [value, expected] of [
    [prefix, '/'], [`${prefix}/`, '/'], [`${prefix}?from=menu#top`, '/?from=menu#top'],
    [`${prefix}/pricing?plan=pro&yearly=1#details`, '/pricing?plan=pro&yearly=1#details'],
    [`https://preview.example.com${prefix}/developers#template-studio`, '/developers#template-studio'],
    [`https://mail.example.com${prefix}/pricing`, '/pricing'],
    [`http://mail.example.com${prefix}/pricing`, '/pricing'],
    [`//preview.example.com${prefix}/pricing`, '/pricing'],
  ]) assert.equal(productionLink(value, project, instance), expected, value);
  for (const value of [
    '/pricing', '/', '#main', 'pricing', 'mailto:hello@example.com',
    '/sites/sendmailos-live-copy/pricing', '/sites/another-project/pricing',
    'https://dash.example.com/login', `https://external.example.com${prefix}/pricing`,
    `https://preview.example.com.evil.test${prefix}/pricing`,
    `https://user@preview.example.com${prefix}/pricing`,
    `https://preview.example.com:8443${prefix}/pricing`,
    `${prefix}//external.example.com`, `${prefix}/\\external.example.com`,
    `${prefix}/%5cexternal.example.com`, `${prefix}/%0d%0aLocation:evil`,
    `${prefix}/pricing\n`, '/media/project/image.png',
  ]) assert.equal(productionLink(value, project, instance), value, value);
  assert.equal(projectRootPath('/sites/another-project/pricing', project.slug), null);
});

test('HTML-aware navigation rewriting preserves scripts, CSS, images and editable source', () => {
  const untouched = `<script>const example='<a href="${prefix}/pricing">example</a>';</script>`
    + `<style>.a:after{content:'href="${prefix}/pricing"'}</style>`
    + `<!-- <a href="${prefix}/pricing">Example</a> -->`
    + `<textarea><a href="${prefix}/pricing">Example</a></textarea>`
    + `<img src="${prefix}/image.png"><a href="https://external.example.com${prefix}/pricing">External</a>`;
  const input = `<a class="menu" HREF='${prefix}/developers?source=menu&amp;v=2#template-studio' data-x=">">Go</a>`
    + `<a href=${prefix}>Home</a><a href="/sites/sendmailos&#45;live/pricing">Encoded</a>`
    + `<form action="${prefix}/search"><button formaction="${prefix}/contact">Submit</button></form>`
    + `<template><a href="${prefix}/pricing">Template</a></template>`
    + `<noscript><a href="${prefix}/pricing">Fallback</a></noscript>${untouched}`;
  const result = productionNavigation(input, project, instance);
  assert.match(result, /class="menu" href="\/developers\?source=menu&amp;v=2#template-studio" data-x=">"/);
  assert.match(result, /href="\/">Home/); assert.match(result, /href="\/pricing">Encoded/);
  assert.match(result, /action="\/search"/); assert.match(result, /formaction="\/contact"/);
  assert.match(result, /<template><a href="\/pricing">Template/);
  assert.match(result, /<noscript><a href="\/pricing">Fallback/);
  assert.ok(result.endsWith(untouched));
});

async function port() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const result = server.address().port;
  await new Promise(resolve => server.close(resolve)); return result;
}

test('existing imported pages get clean domain navigation and permanent aliases without a reimport', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'lumasite-clean-urls-'));
  const store = await openStore(dataDir), adminPort = await port(), sitePort = await port();
  await initializeInstance(store, { password: 'Clean-url-fixture-123!', port: adminPort, sitePort, publicUrl: `http://127.0.0.1:${adminPort}`, sitePublicUrl: 'https://preview.example.com' });
  const { project: site } = await createProject(store, { name: 'Mail', ...project });
  const home = store.read().pages.find(p => p.projectId === site.id);
  const html = `<nav><a href="${prefix}/">Home</a><a href="${prefix}/pricing">Pricing</a><a href="${prefix}/developers#template-studio">Developers</a></nav><h1>Imported site</h1><!-- lumasite:blog-list -->`;
  await updatePage(store, site.id, home.id, { html, js: 'window.originalScript = true;' });
  await publishPage(store, site.id, home.id);
  for (const slug of ['pricing', 'developers', 'blog/sample']) {
    const page = await createPage(store, site.id, { slug, title: slug, html: `${html}<section id="template-studio">Templates</section>`, seo: slug.includes('/') ? { type: 'article' } : {} });
    await publishPage(store, site.id, page.id);
  }
  await createPage(store, site.id, { slug: 'private', title: 'Unpublished' });
  const other = (await createProject(store, { name: 'Other', domain: 'other.example.com' })).project;
  await publishPage(store, other.id, store.read().pages.find(p => p.projectId === other.id).id);
  const stateBefore = await readFile(path.join(dataDir, 'state.json'));
  const credentialsBefore = await readFile(path.join(dataDir, 'credentials.json'));
  const servers = await startServers({ store });
  t.after(async () => { await servers.close(); await rm(dataDir, { recursive: true, force: true }); });
  const get = (route, host = project.domain, method = 'GET') => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: sitePort, path: route, method, headers: { Host: host } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }); req.on('error', reject); req.end();
  });
  for (const route of ['/', '/pricing', '/developers']) {
    const res = await get(route); assert.equal(res.status, 200, route);
    assert.equal(res.headers['x-robots-tag'], undefined);
    assert.match(res.body, /href="\/pricing"/); assert.match(res.body, /href="\/developers#template-studio"/);
    assert.doesNotMatch(res.body, /href="\/sites\/sendmailos-live/);
    assert.match(res.body, /data-blog-link href="\/blog\/sample"/);
    assert.match(res.body, new RegExp(`rel="canonical" href="https://${project.domain}${route}"`));
  }
  for (const [route, target] of [[prefix, '/'], [`${prefix}/`, '/'], [`${prefix}/pricing?plan=pro&yearly=1`, '/pricing?plan=pro&yearly=1'], [`${prefix}/developers`, '/developers'], [`${prefix}/sitemap.xml`, '/sitemap.xml']]) {
    for (const method of ['GET', 'HEAD']) {
      const res = await get(route, project.domain, method);
      assert.equal(res.status, 301, route); assert.equal(res.headers.location, target);
      assert.equal(res.headers['x-robots-tag'], undefined, 'Crawlers can follow the canonical redirect');
      assert.equal(res.headers['cache-control'], 'no-cache'); assert.equal(res.body, '');
    }
  }
  for (const bad of [`${prefix}//external.example.com`, `${prefix}/\\external.example.com`, `${prefix}/%5cexternal.example.com`]) {
    const res = await get(bad); assert.equal(res.status, 404); assert.equal(res.headers.location, undefined);
  }
  assert.equal((await get('/private')).status, 404);
  const robots = await get('/robots.txt');
  assert.ok(robots.body.includes(`Allow: ${prefix}/\nAllow: ${prefix}$`), 'Production robots permits crawling the project aliases to discover their 301s');
  for (const host of ['preview.example.com', '127.0.0.1', other.domain]) {
    const res = await get(`${prefix}/pricing`, host); assert.equal(res.status, 200);
    assert.match(res.headers['x-robots-tag'], /noindex/); assert.match(res.body, new RegExp(`href="${prefix}/pricing"`));
    assert.match(res.body, new RegExp(`data-blog-link href="${prefix}/blog/sample"`));
  }
  const preview = new URL(getPreviewUrl(store.read(), site.id, home.id));
  const signed = await get(preview.pathname + preview.search, 'preview.example.com');
  assert.equal(signed.status, 200); assert.match(signed.body, new RegExp(`href="${prefix}/pricing"`));
  const prod = await get('/'), local = await get(`${prefix}/`, 'preview.example.com');
  const assets = body => [...body.matchAll(/(?:href|src)="(\/content-assets\/[^\"]+)"/g)].map(m => m[1]);
  assert.deepEqual(assets(prod.body), assets(local.body), 'Root and preview reuse the same immutable CSS/JS');
  assert.equal(await readFile(path.join(dataDir, 'state.json')).then(b => b.equals(stateBefore)), true);
  assert.equal(await readFile(path.join(dataDir, 'credentials.json')).then(b => b.equals(credentialsBefore)), true);
});
