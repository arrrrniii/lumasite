import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { openStore } from '../src/store.mjs';
import { initializeInstance, createProject, getPreviewUrl, restorePage } from '../src/service.mjs';
import { startServers } from '../src/server.mjs';
import { exportProject, importProject } from '../src/migration.mjs';
import { renderLocalizedNavigation, menuSchema } from '../src/i18n.mjs';
import { prefixedLanguageAssignments } from '../src/legacy-locales.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const languages = { defaultLocale: 'en', locales: [{ code: 'en', label: 'English' }, { code: 'sq', label: 'Shqip', readMoreLabel: 'Lexo artikullin' }, { code: 'it', label: 'Italiano' }], expectedRevision: 0 };
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lumasite-languages-'));
  const sockets = await Promise.all([0, 1].map(() => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => resolve(s)); })));
  const [port, sitePort] = sockets.map(s => s.address().port);
  await Promise.all(sockets.map(s => new Promise(resolve => s.close(resolve))));
  const store = await openStore(dir);
  await initializeInstance(store, { password: 'Languages-Integration-Password!', port, sitePort, publicUrl: `http://127.0.0.1:${port}`, sitePublicUrl: `http://127.0.0.1:${sitePort}` });
  const { project, token } = await createProject(store, { name: 'Languages', domain: 'languages.example.com' });
  const servers = await startServers({ store, dataDir: dir });
  const client = new Client({ name: 'language-test', version: '1' });
  t.after(async () => { await client.close(); await servers.close(); await rm(dir, { recursive: true, force: true }); });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp/${project.id}`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  const raw = (name, args = {}) => client.callTool({ name, arguments: args });
  const call = async (name, args = {}) => { const r = await raw(name, args); assert.notEqual(r.isError, true, JSON.stringify(r)); return r.structuredContent || JSON.parse(r.content[0].text); };
  const get = (route, host = project.domain) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: sitePort, path: route, headers: { Host: host } }, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() })); }); req.on('error', reject); req.end();
  });
  const translation = async (locale, translationKey, localPath, extra = {}) => (await call('translation_upsert', { locale, translationKey, path: localPath, title: `${locale} ${translationKey}`, html: `<main><h1>${locale} ${translationKey}</h1></main>`, ...extra })).page;
  const publish = p => call('page_publish', { pageId: p.id });
  const enable = () => call('languages_update', languages);
  return { dataDir: dir, store, project, client, call, raw, get, translation, publish, enable };
}

test('MCP manages languages, translated pages, localized layouts, menus and live navigation without Studio', async t => {
  const f = await fixture(t);
  const tools = (await f.client.listTools()).tools.map(t => t.name);
  for (const name of ['languages_get', 'languages_update', 'translations_list', 'translation_upsert', 'menus_get', 'menu_upsert', 'menu_remove', 'menus_publish']) assert.ok(tools.includes(name));
  assert.equal(tools.length, 32);
  await f.enable();
  const initial = (await f.call('pages_list')).pages[0];
  await f.call('layout_update', { expectedRevision: 0, header: '<header><!-- lumasite:menu:primary --><!-- lumasite:languages --></header>', footer: '<footer>English footer</footer>', locales: { sq: { footer: '<footer class="text-violet-600">Fund shqip {{page.locale}}</footer>' } } });
  await f.call('layout_publish', { expectedRevision: 1 });
  const home = await f.translation('en', 'home', '', { pageId: initial.id, revision: initial.revision, layoutMode: 'global' });
  const en = await f.translation('en', 'pricing', 'pricing', { html: '<main>English pricing</main>', layoutMode: 'global' });
  const sq = await f.translation('sq', 'pricing', 'cmimet', { html: '<main>Çmimet <a href="/pricing?plan=pro#details">Plan</a><a href="https://outside.example/pricing">Outside</a></main>', layoutMode: 'global' });
  const it = await f.translation('it', 'pricing', 'prezzi', { layoutMode: 'global' });
  const sqHome = await f.translation('sq', 'home', '', { layoutMode: 'global' });
  for (const p of [home, sqHome, en, sq]) await f.publish(p);
  assert.equal((await f.get('/sq/')).status, 200);
  assert.match((await f.get('/sq/')).body, /rel="canonical" href="https:\/\/languages.example.com\/sq\/"/);
  for (const [locale, label, revision] of [['en', 'Pricing', 0], ['sq', 'Çmimet', 1]]) await f.call('menu_upsert', { key: 'primary', locale, label: 'Main navigation', expectedRevision: revision, items: [{ label, translationKey: 'pricing' }, { label: 'Missing', translationKey: 'missing' }] });
  assert.doesNotMatch((await f.get('/sq/cmimet')).body, /Main navigation/);
  await f.call('menus_publish', { expectedRevision: 2 });
  let live = (await f.get('/sq/cmimet')).body;
  assert.match(live, /href="\/sq\/cmimet" aria-current="page">Çmimet/);
  assert.match(live, /href="\/sq\/cmimet\?plan=pro#details"/);
  assert.match(live, /href="https:\/\/outside.example\/pricing"/);
  assert.match(live, /Fund shqip sq/);
  assert.doesNotMatch(live, /English footer|>Missing<|\/it\/prezzi/);
  assert.match(live, /data-ls-language="en" href="\/pricing"/);
  assert.match(live, /data-ls-language="sq" href="\/sq\/cmimet"/);
  const cssUrl = live.match(/href="([^\"]*layout-assets[^\"]*\.css)"/)[1];
  assert.match((await f.get(cssUrl)).body, /text-violet-600/);
  await f.publish(it);
  assert.match((await f.get('/sq/cmimet')).body, /href="\/it\/prezzi"/);
  await f.call('menu_upsert', { key: 'primary', locale: 'sq', label: 'Main navigation', expectedRevision: 2, items: [{ label: 'Private label', translationKey: 'pricing' }] });
  assert.doesNotMatch((await f.get('/sq/cmimet')).body, /Private label/);
  const preview = new URL(getPreviewUrl(f.store.read(), f.project.id, sq.id));
  const draft = await f.get(preview.pathname + preview.search, '127.0.0.1');
  assert.match(draft.body, /Private label/); assert.match(draft.body, /href="\/sites\/languages\/sq\/cmimet"/); assert.match(draft.headers['x-robots-tag'], /noindex/);
  await f.call('menu_remove', { key: 'primary', locale: 'sq', expectedRevision: 3 });
  await f.call('menus_publish', { expectedRevision: 4 });
  assert.doesNotMatch((await f.get('/sq/cmimet')).body, /aria-label="Main navigation"/);
  const groups = (await f.call('translations_list', { translationKey: 'pricing' })).groups;
  assert.deepEqual(groups[0].missing, []);
  assert.equal(groups[0].translations.find(p => p.locale === 'sq').publishedPath, 'sq/cmimet');
});

test('existing prefix pages adopt language metadata atomically without publishing pending content', async t => {
  const f = await fixture(t);
  const en = (await f.call('page_upsert', { slug: 'pricing', title: 'Pricing', html: '<h1>Live English</h1>' })).page;
  const sq = (await f.call('page_upsert', { slug: 'sq/pricing', title: 'Çmimet', html: '<h1>Live Albanian</h1>' })).page;
  const sqHome = (await f.call('page_upsert', { slug: 'sq', title: 'Kryefaqja', seo: { canonical: 'https://languages.example.com/sq' }, html: '<h1>Live home</h1>' })).page;
  for (const page of [en, sq, sqHome]) await f.publish(page);
  const before = structuredClone(f.store.read().revisions);
  const draft = (await f.call('page_upsert', { pageId: sq.id, revision: sq.revision, html: '<h1>Private draft</h1>' })).page;
  const assignments = [
    { pageId: en.id, expectedRevision: en.revision, locale: 'en', translationKey: 'pricing' },
    { pageId: sq.id, expectedRevision: draft.revision, locale: 'sq', translationKey: 'pricing' },
    { pageId: sqHome.id, expectedRevision: sqHome.revision, locale: 'sq', translationKey: 'home' },
  ];
  assert.equal((await f.raw('languages_update', languages)).isError, true, 'Old enable flow cannot reinterpret legacy prefixes');
  const unchanged = JSON.stringify(f.store.read());
  const stale = assignments.map(a => ({ ...a })); stale[1].expectedRevision--;
  assert.equal((await f.raw('languages_update', { ...languages, assignments: stale })).isError, true);
  assert.equal(JSON.stringify(f.store.read()), unchanged, 'A stale assignment rolls back every change');
  await f.call('languages_update', { ...languages, assignments });
  const live = (await f.get('/sq/pricing')).body;
  assert.match(live, /<html lang="sq"/);
  assert.match(live, /Live Albanian/); assert.doesNotMatch(live, /Private draft/);
  assert.match(live, /hreflang="en" href="https:\/\/languages.example.com\/pricing"/);
  assert.match(live, /hreflang="sq" href="https:\/\/languages.example.com\/sq\/pricing"/);
  assert.match(live, /property="og:locale" content="sq_AL"/);
  assert.match((await f.get('/sitemap.xml')).body, /<loc>https:\/\/languages.example.com\/sq<\/loc>/);
  const state = f.store.read();
  assert.match(state.pages.find(p => p.id === sq.id).html, /Private draft/);
  for (const revision of before) assert.deepEqual(state.revisions.find(r => r.id === revision.id), revision, 'Published history remains immutable');
  const count = state.revisions.length;
  const currentAssignments = assignments.map(a => ({ ...a, expectedRevision: state.pages.find(p => p.id === a.pageId).revision }));
  await f.call('languages_update', { ...languages, expectedRevision: 1, assignments: currentAssignments });
  assert.equal(f.store.read().revisions.length, count, 'An already assigned page needs no extra published snapshot');
});

test('local adoption command defaults to a dry run and applies through authenticated MCP', async t => {
  const f = await fixture(t);
  const en = (await f.call('page_upsert', { slug: 'pricing', title: 'Pricing', html: '<h1>English</h1>' })).page;
  const sq = (await f.call('page_upsert', { slug: 'sq/pricing', title: 'Çmimet', html: '<h1>Shqip</h1>' })).page;
  for (const p of [en, sq]) await f.publish(p);
  const command = [path.resolve('scripts/adopt-prefixed-pages.mjs'), '--data-dir', f.dataDir, '--project', f.project.id];
  const before = JSON.stringify(f.store.read());
  const dry = await promisify(execFile)(process.execPath, command);
  assert.match(dry.stdout, /"mode": "dry-run"/);
  assert.equal(JSON.stringify(f.store.read()), before);
  const applied = await promisify(execFile)(process.execPath, [...command, '--apply']);
  assert.match(applied.stdout, /"applied":true/);
  assert.match((await f.get('/sq/pricing')).body, /<html lang="sq"/);
  assert.equal(f.store.read().pages.find(p => p.id === sq.id).translationKey, 'pricing');
});

test('legacy assignment planning refuses missing equivalents and colliding home keys', () => {
  const locales = [{ code: 'en' }, { code: 'sq' }];
  const page = (id, slug) => ({ id, slug, revision: 1 });
  assert.throws(() => prefixedLanguageAssignments([page('a','sq/missing')], locales), /No default-language equivalent/);
  assert.throws(() => prefixedLanguageAssignments([page('a',''),page('b','sq'),page('c','home'),page('d','sq/home')], locales), /Multiple base pages/);
});

test('language and translation validation prevents stale edits, duplicate groups, invalid prefixes and cross-project changes', async t => {
  const f = await fixture(t); await f.enable();
  const sq = await f.translation('sq', 'pricing', 'cmimet'); await f.publish(sq);
  for (const [name, args] of [
    ['languages_update', languages],
    ['languages_update', { ...languages, expectedRevision: 1, locales: [{ code: 'en', label: 'English' }, { code: 'en', label: 'Duplicate' }] }],
    ['languages_update', { ...languages, expectedRevision: 1, locales: [{ code: 'en', label: 'English' }] }],
    ['translation_upsert', { locale: 'sq', translationKey: 'pricing', path: 'cmimet', html: 'No revision' }],
    ['page_upsert', { slug: 'wrong-prefix', locale: 'sq', translationKey: 'wrong' }],
    ['page_upsert', { slug: 'sq/other', locale: 'sq', translationKey: 'pricing' }],
    ['page_upsert', { slug: 'one-field', locale: 'en' }],
    ['page_upsert', { slug: 'sq/default' }],
    ['menu_upsert', { key: 'primary', locale: 'fr', label: 'Menu', items: [], expectedRevision: 0 }],
    ['menus_publish', { expectedRevision: 9 }],
  ]) assert.equal((await f.raw(name, args)).isError, true, name);
  const other = await createProject(f.store, { name: 'Other' });
  const foreign = f.store.read().pages.find(p => p.projectId === other.project.id);
  assert.equal((await f.raw('translation_upsert', { pageId: foreign.id, revision: 1, locale: 'sq', translationKey: 'stolen', path: 'stolen' })).isError, true);
  const before = f.store.read().pages;
  assert.equal((await f.raw('translation_upsert', { pageId: sq.id, revision: 999, locale: 'sq', translationKey: 'pricing', path: 'cmimet', html: 'stale' })).isError, true);
  assert.deepEqual(f.store.read().pages, before);
  assert.equal((await f.raw('translation_delete', { pageId: sq.id, expectedRevision: sq.revision, confirmPath: '/wrong' })).isError, true);
  const changed = await f.translation('sq', 'pricing-new', 'cmimet', { pageId: sq.id, revision: sq.revision });
  // An unpublished group change cannot silently change the live group or links.
  const groups = await f.call('translations_list'); assert.equal(groups.groups[0].translations[0].publishedPath, 'sq/cmimet');
  const old = f.store.read().revisions.find(r => r.pageId === sq.id);
  await restorePage(f.store, f.project.id, changed.id, old.id);
  const restored = f.store.read().pages.find(p => p.id === sq.id);
  assert.equal(restored.translationKey, 'pricing');
  const deleted = await f.call('translation_delete', { pageId: sq.id, expectedRevision: restored.revision, confirmPath: '/sq/cmimet' });
  assert.equal(deleted.status, 'deleted'); assert.ok(deleted.backup.download);
  assert.equal((await f.get('/sq/cmimet')).status, 404);
  assert.equal(f.store.read().pages.some(p => p.id === foreign.id), true);
  await f.call('languages_update', { ...languages, expectedRevision: 1, locales: [{ code: 'en', label: 'English' }] });
});

test('localized SEO emits reciprocal indexable alternates, self canonicals, sitemap and RTL metadata', async t => {
  const f = await fixture(t); await f.enable();
  const en = await f.translation('en', 'pricing', 'pricing'), sq = await f.translation('sq', 'pricing', 'cmimet');
  await f.publish(en); await f.publish(sq);
  for (const route of ['/pricing', '/sq/cmimet']) {
    const live = (await f.get(route)).body;
    assert.match(live, /hreflang="en" href="https:\/\/languages.example.com\/pricing"/);
    assert.match(live, /hreflang="sq" href="https:\/\/languages.example.com\/sq\/cmimet"/);
    assert.match(live, /hreflang="x-default" href="https:\/\/languages.example.com\/pricing"/);
    assert.match(live, new RegExp(`<link rel="canonical" href="https://languages.example.com${route}"`));
  }
  let live = (await f.get('/sq/cmimet')).body;
  assert.match(live, /<html lang="sq" dir="ltr">/); assert.match(live, /"inLanguage":"sq"/);
  assert.doesNotMatch(live, /"name":"sq"/);
  let sitemap = (await f.get('/sitemap.xml')).body;
  assert.match(sitemap, /xmlns:xhtml="http:\/\/www.w3.org\/1999\/xhtml"/);
  assert.equal((sitemap.match(/xhtml:link rel="alternate" hreflang="sq"/g) || []).length, 2);
  await f.call('page_upsert', { pageId: sq.id, revision: sq.revision, seo: { noindex: true } });
  await f.publish(sq);
  assert.doesNotMatch((await f.get('/pricing')).body, /hreflang="sq"/);
  sitemap = (await f.get('/sitemap.xml')).body; assert.doesNotMatch(sitemap, /\/sq\/cmimet/);
  await f.call('languages_update', { ...languages, expectedRevision: 1, locales: [...languages.locales, { code: 'ar', label: 'العربية', direction: 'rtl' }, { code: 'en-GB', label: 'British English' }] });
  const ar = await f.translation('ar', 'pricing', 'prices'); await f.publish(ar);
  assert.match((await f.get('/ar/prices')).body, /<html lang="ar" dir="rtl">/);
  const gb = await f.translation('en-GB', 'pricing', 'prices'); await f.publish(gb);
  assert.equal(gb.slug, 'en-gb/prices');
  assert.match((await f.get('/pricing')).body, /hreflang="en-GB"/);
});

test('ZIP create and update preserve language settings, translation groups, menu snapshots and localized layout code', async t => {
  const f = await fixture(t); await f.enable();
  await f.call('layout_update', { expectedRevision: 0, header: '<!-- lumasite:menu:primary -->', footer: '', locales: { sq: { header: '<header><a href="/sites/languages/sq/cmimet">Lidhje</a><!-- lumasite:menu:primary --></header>' } } });
  await f.call('layout_publish', { expectedRevision: 1 });
  const p = await f.translation('sq', 'pricing', 'cmimet', { layoutMode: 'global' }); await f.publish(p);
  await f.call('menu_upsert', { key: 'primary', locale: 'sq', label: 'Menu shqip', expectedRevision: 0, items: [{ label: 'Çmimet', translationKey: 'pricing' }, { label: 'Direct', href: '/sites/languages/sq/cmimet#details' }] });
  await f.call('menus_publish', { expectedRevision: 1 });
  const zip = await exportProject(f.store, f.project.id);
  const copy = await importProject(f.store, zip.buffer, { slug: 'languages-copy', domain: 'copy.example.com', linkMode: 'domain' });
  let project = f.store.read().projects.find(p => p.id === copy.project.id);
  assert.equal(project.languages.locales[1].label, 'Shqip'); assert.equal(project.navigation.published.menus[0].items[0].translationKey, 'pricing');
  assert.equal(project.navigation.published.menus[0].items[1].href, '/sq/cmimet#details');
  assert.doesNotMatch(project.layout.published.locales.sq.header, /sites\/languages\//);
  const page = f.store.read().pages.find(p => p.projectId === copy.project.id && p.locale === 'sq');
  assert.equal(page.translationKey, 'pricing');
  assert.match((await f.get('/sq/cmimet', 'copy.example.com')).body, /Menu shqip/);
  await importProject(f.store, zip.buffer, { mode: 'update', projectId: copy.project.id, confirmSlug: 'languages-copy' });
  project = f.store.read().projects.find(p => p.id === copy.project.id);
  assert.equal(project.navigation.published.menus[0].locale, 'sq'); assert.equal(project.languages.defaultLocale, 'en');
});

test('blog lists and RSS stay within their language and never expose unpublished articles', async t => {
  const f = await fixture(t); await f.enable();
  for (const [locale, slug] of [['en', 'blog'], ['sq', 'blog']]) {
    const p = await f.translation(locale, 'blog', slug, { html: '<main><!-- lumasite:blog-list --></main>' }); await f.publish(p);
  }
  for (const [locale, name] of [['en', 'English article'], ['sq', 'Artikull shqip']]) {
    const p = await f.translation(locale, 'article', 'blog/article', { title: name, seo: { type: 'article' } }); await f.publish(p);
  }
  await f.translation('sq', 'private', 'blog/private', { title: 'PRIVATE ARTICLE', seo: { type: 'article' } });
  const sq = (await f.get('/sq/blog')).body;
  assert.match(sq, /Artikull shqip/); assert.match(sq, /Lexo artikullin/); assert.doesNotMatch(sq, /English article|PRIVATE ARTICLE/);
  const feed = (await f.get('/sq/feed.xml')).body;
  assert.match(feed, /Artikull shqip/); assert.doesNotMatch(feed, /English article|PRIVATE ARTICLE/);
  assert.match((await f.get('/feed.xml')).body, /English article/);
  assert.doesNotMatch((await f.get('/feed.xml')).body, /Artikull shqip/);
});

test('navigation markers preserve scripts and menu input escapes text and rejects unsafe destinations', () => {
  for (const href of ['javascript:alert(1)', '//outside.example/path', '/\\outside', 'data:text/html,test']) assert.equal(menuSchema.safeParse({ key: 'primary', locale: 'en', label: 'Nav', items: [{ label: 'X', href }] }).success, false);
  const project = { id: 'p', slug: 'p', domain: 'p.example.com', languages: { defaultLocale: 'en', locales: [{ code: 'en', label: 'English' }] } }, page = { id: 'a', slug: '', translationKey: 'home', locale: 'en' };
  const state = { instance: { sitePublicUrl: 'https://preview.example.com' }, pages: [], revisions: [] };
  const html = '<script>const marker="<!-- lumasite:languages -->";const link=\'<a href="/">x</a>\';</script><!-- lumasite:languages -->';
  const rendered = renderLocalizedNavigation(html, state, project, page);
  assert.ok(rendered.startsWith(html.slice(0, html.indexOf('</script>') + 9))); assert.match(rendered, /class="ls-languages"/);
});
