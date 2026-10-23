import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { openStore } from '../src/store.mjs';
import { initializeInstance, createProject, createPage, publishPage } from '../src/service.mjs';
import { startServers } from '../src/server.mjs';
import { updateIntegrations } from '../src/integrations.mjs';

async function port() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const value = s.address().port; await new Promise(r => s.close(r)); return value; }
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'lumasite-integrations-browser-')), store = await openStore(dataDir);
const adminPort = await port(), sitePort = await port(), admin = `http://localhost:${adminPort}`, production = `http://tags.example.com:${sitePort}`;
await initializeInstance(store, { password: 'Integration-browser-123!', port: adminPort, sitePort, publicUrl: admin });
const { project } = await createProject(store, { name: 'Integration example', domain: 'tags.example.com' });
const home = store.read().pages.find(p => p.projectId === project.id); await publishPage(store, project.id, home.id);
const article = await createPage(store, project.id, { slug: 'blog/example', title: 'Example blog', html: '<main><h1>An existing blog</h1></main>', seo: { type: 'article' } }); await publishPage(store, project.id, article.id);
const publishedBefore = JSON.stringify(store.read().revisions);
const servers = await startServers({ store }); let browser;
const results = path.resolve('test-results'); await mkdir(results, { recursive: true });
try {
  browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP tags.example.com 127.0.0.1', '--no-proxy-server'] });
  const adminPage = await browser.newPage({ viewport: { width: 1512, height: 1000 }, reducedMotion: 'reduce' }), errors = [];
  adminPage.on('pageerror', e => errors.push(e.message)); adminPage.on('dialog', d => d.accept());
  await adminPage.goto(admin + '/admin'); await adminPage.getByLabel('Admin password', { exact: true }).fill('Integration-browser-123!'); await adminPage.getByRole('button', { name: 'Open studio', exact: true }).click();
  await adminPage.getByRole('button', { name: /Integration example/ }).click(); await adminPage.getByRole('button', { name: 'Integrations', exact: true }).click();
  await adminPage.getByRole('heading', { name: 'Connect your website.', exact: true }).waitFor();
  await adminPage.getByLabel('GA4 measurement ID', { exact: true }).fill('invalid'); await adminPage.getByRole('button', { name: 'Save Google settings', exact: true }).click();
  await adminPage.getByText('Use a GA4 measurement ID such as G-ABC1234567.', { exact: true }).waitFor();
  assert.equal(store.read().projects[0].integrations, undefined);
  await adminPage.getByLabel('GA4 measurement ID', { exact: true }).fill('G-TEST12345'); await adminPage.getByLabel('Enable Google tracking on production', { exact: true }).check();
  await adminPage.getByRole('button', { name: 'Save Google settings', exact: true }).click(); await adminPage.getByText('Google settings saved for all production pages.', { exact: true }).waitFor();
  await adminPage.getByLabel('Google verification token or meta tag', { exact: true }).fill('<meta name="google-site-verification" content="browser_verification_123">');
  await adminPage.getByRole('button', { name: 'Save verification tag', exact: true }).click(); await adminPage.getByText('Tag configured — verify in Google', { exact: true }).waitFor();
  assert.equal(store.read().projects[0].integrations.googleAnalyticsId, 'G-TEST12345');
  await adminPage.getByRole('button', { name: 'Add custom tag', exact: true }).click();
  await adminPage.getByLabel('Tag name', { exact: true }).fill('Optional example');
  await adminPage.getByLabel('HTML or script snippet', { exact: true }).fill('<script>window.optionalTagRuns=(window.optionalTagRuns||0)+1;</script>');
  await adminPage.getByRole('button', { name: 'Save custom tag', exact: true }).click(); await adminPage.getByText('Custom tag saved for all production pages.', { exact: true }).waitFor();
  assert.equal(await adminPage.evaluate(() => window.optionalTagRuns), undefined, 'Custom code does not run in Studio');
  assert.equal(JSON.stringify(store.read().revisions), publishedBefore);
  await adminPage.locator('#main').focus(); await adminPage.evaluate(() => { scrollTo(0, 0); document.getElementById('notifications').replaceChildren(); });
  await adminPage.screenshot({ path: path.join(results, 'studio-integrations.png'), fullPage: true });
  console.log('PASS dashboard saves Google IDs, full verification meta tags and custom snippets without changing existing published blogs');

  const context = await browser.newContext(), requests = [];
  await context.route('https://www.googletagmanager.com/**', route => { requests.push(route.request().url()); return route.fulfill({ contentType: 'text/javascript', body: 'window.googleLoaderRuns=(window.googleLoaderRuns||0)+1;' }); });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(production + '/');
  await page.getByRole('heading', { name: 'Your privacy choices', exact: true }).waitFor();
  assert.equal(await page.locator('meta[name="google-site-verification"]').getAttribute('content'), 'browser_verification_123');
  assert.equal(requests.length, 0); assert.equal(await page.evaluate(() => window.optionalTagRuns), undefined);
  await page.getByRole('button', { name: 'Accept optional tags', exact: true }).click();
  await page.waitForFunction(() => window.optionalTagRuns === 1 && window.googleLoaderRuns === 1);
  assert.equal(requests.length, 1);
  await page.goto(production + '/blog/example'); await page.waitForFunction(() => window.optionalTagRuns === 1 && window.googleLoaderRuns === 1);
  assert.equal(await page.getByRole('button', { name: 'Accept optional tags', exact: true }).count(), 0);
  assert.equal(requests.length, 2, 'Saved acceptance applies to another existing page');
  await page.getByRole('button', { name: 'Privacy settings', exact: true }).click();
  const navigation = page.waitForNavigation(); await page.getByRole('button', { name: 'Reject optional tags', exact: true }).click(); await navigation;
  await page.getByRole('button', { name: 'Privacy settings', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.optionalTagRuns), undefined); assert.equal(requests.length, 2);
  console.log('PASS consent blocks all optional requests before acceptance, persists on navigation, and reloads without tags after rejection');

  await page.goto(`http://localhost:${sitePort}/sites/${project.slug}/`);
  assert.equal(await page.locator('meta[name="google-site-verification"]').count(), 0); assert.equal(await page.locator('#lumasite-privacy').count(), 0);
  assert.equal(await page.evaluate(() => window.optionalTagRuns), undefined); assert.equal(requests.length, 2);
  console.log('PASS published preview contains no verification tag, consent banner, Google loader or custom code');
  await context.close();

  await adminPage.getByRole('button', { name: 'Disable Optional example', exact: true }).click(); await adminPage.getByText('Custom tag updated.', { exact: true }).waitFor();
  assert.equal(store.read().projects[0].integrations.customTags[0].enabled, false);
  await adminPage.getByRole('button', { name: 'Edit Optional example', exact: true }).click(); await adminPage.getByLabel('Tag name', { exact: true }).fill('Renamed example'); await adminPage.getByRole('button', { name: 'Save custom tag', exact: true }).click();
  await adminPage.getByRole('heading', { name: 'Renamed example', exact: true }).waitFor();
  await adminPage.getByRole('button', { name: 'Delete Renamed example', exact: true }).click(); await adminPage.getByRole('heading', { name: 'Your next integration goes here.', exact: true }).waitFor();
  assert.equal(store.read().projects[0].integrations.customTags.length, 0);
  for (const width of [390, 320]) {
    await adminPage.setViewportSize({ width, height: 844 });
    await adminPage.waitForFunction(() => document.getElementById('studio-navigation').inert && document.getElementById('studio-navigation').getBoundingClientRect().right <= 0);
    assert.equal(await adminPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `No overflow at ${width}px`);
  }
  await adminPage.locator('#main').focus(); await adminPage.evaluate(() => { scrollTo(0, 0); document.getElementById('notifications').replaceChildren(); });
  await adminPage.screenshot({ path: path.join(results, 'studio-integrations-mobile.png'), fullPage: true });
  console.log('PASS custom snippets can be disabled, edited and deleted; dashboard remains usable at 390px and 320px');
  await updateIntegrations(store, project.id, { trackingEnabled: false, customTags: [
    { name: 'First', placement: 'bodyStart', code: '<span data-order="first"></span>' },
    { name: 'Second', placement: 'bodyStart', code: '<span data-order="second"></span>' },
  ] });
  const ordered = await browser.newPage({ viewport: { width: 320, height: 844 } }); await ordered.goto(production + '/'); assert.equal(await ordered.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); await ordered.getByRole('button', { name: 'Accept optional tags', exact: true }).click();
  await ordered.waitForFunction(() => document.querySelectorAll('[data-order]').length === 2);
  assert.deepEqual(await ordered.locator('[data-order]').evaluateAll(elements => elements.map(e => e.dataset.order)), ['first', 'second']);
  await ordered.close(); console.log('PASS optional body-start snippets retain their configured order');
  assert.deepEqual(errors, []); console.log(JSON.stringify({ passed: 5, browserErrors: 0 }));
} finally { await browser?.close(); await servers.close(); await rm(dataDir, { recursive: true, force: true }); }
