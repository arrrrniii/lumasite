// Exercise real browser redirects, fragments, native navigation and previews.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { openStore } from '../src/store.mjs';
import { initializeInstance, createProject, updatePage, createPage, publishPage } from '../src/service.mjs';
import { startServers } from '../src/server.mjs';

async function port() {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const result = server.address().port; await new Promise(resolve => server.close(resolve)); return result;
}
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'lumasite-navigation-browser-'));
const store = await openStore(dataDir), adminPort = await port(), sitePort = await port();
await initializeInstance(store, { password: 'Navigation-test-123!', port: adminPort, sitePort, publicUrl: `http://localhost:${adminPort}` });
const { project } = await createProject(store, { name: 'Mail', slug: 'mail-live', domain: 'mail.example.com' });
const prefix = '/sites/mail-live';
const html = `<nav><a href="${prefix}/">Home</a><a href="${prefix}/pricing">Pricing</a><a href="${prefix}/developers#template-studio">Template Studio</a></nav><main><h1>Clean navigation</h1><p>Published without rebuilding.</p><div style="height:1200px"></div><h2 id="template-studio">Email templates</h2></main>`;
const home = store.read().pages.find(p => p.projectId === project.id);
await updatePage(store, project.id, home.id, { html }); await publishPage(store, project.id, home.id);
for (const slug of ['pricing', 'developers']) {
  const page = await createPage(store, project.id, { slug, title: slug, html }); await publishPage(store, project.id, page.id);
}
const servers = await startServers({ store }); let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP mail.example.com 127.0.0.1', '--no-proxy-server'] });
  const origin = `http://mail.example.com:${sitePort}`, errors = [];
  for (const javascript of [true, false]) {
    const context = await browser.newContext({ javaScriptEnabled: javascript, viewport: { width: javascript ? 1440 : 390, height: 844 } });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/`);
    await page.getByRole('link', { name: 'Pricing', exact: true }).click(); await page.waitForURL(`${origin}/pricing`);
    await page.getByRole('link', { name: 'Template Studio', exact: true }).click(); await page.waitForURL(`${origin}/developers#template-studio`);
    assert.equal(await page.getByRole('link', { name: 'Home', exact: true }).getAttribute('href'), '/');
    await page.goBack(); assert.equal(page.url(), `${origin}/pricing`);
    const redirected = await page.goto(`${origin}${prefix}/developers?from=old#template-studio`);
    assert.equal(redirected.status(), 200); assert.equal(page.url(), `${origin}/developers?from=old#template-studio`);
    assert.equal(redirected.request().redirectedFrom() !== null, true);
    assert.equal((await redirected.request().redirectedFrom().response()).status(), 301);
    console.log(`PASS clean native navigation, back/forward, 301 and fragment preservation (${javascript ? 'desktop with JS' : 'mobile without JS'})`);
    await page.goto(`http://127.0.0.1:${sitePort}${prefix}/`);
    await page.getByRole('link', { name: 'Pricing', exact: true }).click();
    await page.waitForURL(`http://127.0.0.1:${sitePort}${prefix}/pricing`);
    await context.close();
  }
  assert.deepEqual(errors, []); console.log(JSON.stringify({ passed: 2, browserErrors: 0 }));
} finally { await browser?.close(); await servers.close(); await rm(dataDir, { recursive: true, force: true }); }
