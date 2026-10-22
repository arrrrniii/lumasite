import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { chromium } from 'playwright';
import { openStore } from '../src/store.mjs';
import { initializeInstance } from '../src/service.mjs';
import { startServers } from '../src/server.mjs';

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'lumasite-browser-'));
const results = path.resolve('test-results');
await mkdir(results, { recursive: true });
const port = await freePort(), sitePort = await freePort();
const password = 'Local-Browser-Test-Password-2026';
const store = await openStore(dataDir);
await initializeInstance(store, { port, sitePort, password, publicUrl: `http://localhost:${port}` });
const servers = await startServers({ store });
let browser;
const errors = [], completed = [];
const step = async (name, fn) => { await fn(); completed.push(name); console.log(`PASS ${name}`); };
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1512, height: 982 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const idle = () => page.waitForFunction(() => document.getElementById('app')?.getAttribute('aria-busy') !== 'true');
  await step('Sign in and create a website with generated admin and MCP URLs', async () => {
    await page.goto(`http://localhost:${port}/admin`);
    await page.getByLabel('Admin password').fill(password);
    await page.getByRole('button', { name: 'Open studio' }).click();
    await page.getByRole('heading', { name: 'Create your first website' }).waitFor();
    await page.getByLabel('Website name', { exact: true }).fill('Browser Demo');
    await page.getByLabel(/^Website domain/).fill('browser-demo.example');
    await page.getByRole('button', { name: 'Create website', exact: true }).click();
    await page.getByRole('heading', { name: 'Your website, connected.' }).waitFor();
    assert.match(await page.locator('body').innerText(), /\/mcp\/[a-f0-9-]+/);
    assert.match(await page.locator('body').innerText(), new RegExp(String(port)));
    await idle();
  });
  await step('Preview the starter page with the actual self-hosted LumaFX runtime', async () => {
    await page.getByRole('button', { name: 'Pages', exact: true }).click();
    await page.locator('iframe').waitFor();
    await page.frameLocator('iframe').getByRole('heading', { level: 1 }).waitFor();
    const frame = page.frames().find(f => f.url().includes('/preview/'));
    assert.equal(await frame.evaluate(() => typeof window.lumafx), 'object');
    assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
    await idle();
    await page.screenshot({ path: path.join(results, 'studio-desktop.png'), fullPage: true });
  });
  await step('Create a page and edit its HTML, CSS and browser JavaScript', async () => {
    await page.getByRole('button', { name: 'Add page', exact: true }).click();
    await page.getByLabel('Page title', { exact: true }).fill('Release test');
    await page.getByLabel(/^URL path/).fill('release-test');
    await page.getByRole('button', { name: 'Create page', exact: true }).click();
    await page.getByRole('heading', { name: 'Release test', exact: true }).waitFor();
    await idle();
    await page.locator('textarea[data-page-field="html"]').fill('<main class="p-[37px]"><h1 id="verified" class="text-4xl">Browser verified</h1><p>Published through the real studio.</p></main>');
    await page.getByRole('tab', { name: 'CSS', exact: true }).click();
    await page.locator('textarea[data-page-field="css"]').fill('#verified { color: rgb(14, 91, 126); }');
    await page.getByRole('tab', { name: 'JS', exact: true }).click();
    await page.locator('textarea[data-page-field="js"]').fill('document.documentElement.dataset.browserVerified = "yes";');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await idle();
    await page.frameLocator('iframe').getByRole('heading', { name: 'Browser verified' }).waitFor();
    const frame = page.frames().find(f => f.url().includes('/preview/'));
    await frame.waitForFunction(() => document.documentElement.dataset.browserVerified === 'yes');
    assert.equal(await frame.locator('#verified').evaluate(el => getComputedStyle(el).color), 'rgb(14, 91, 126)');
    assert.equal(await frame.locator('main').evaluate(el => getComputedStyle(el).paddingTop), '37px');
  });
  await step('Add a real LumaFX recipe and publish without restarting', async () => {
    await page.getByRole('button', { name: 'Components', exact: true }).click();
    await page.getByRole('button', { name: 'LumaFX animations', exact: true }).click();
    await page.locator('[data-action="apply-snippet"][data-id="text-reveal"]').click();
    await page.getByRole('button', { name: 'Publish page', exact: true }).click();
    await page.getByText('Page published. Your new revision is live.', { exact: true }).waitFor();
    await idle();
    const project = store.read().projects[0];
    const live = await context.newPage();
    live.on('pageerror', error => errors.push(error.message));
    await live.goto(`http://localhost:${sitePort}/sites/${project.slug}/release-test`);
    await live.waitForFunction(() => document.documentElement.dataset.browserVerified === 'yes');
    assert.equal(await live.getByRole('heading', { name: 'Browser verified' }).count(), 1);
    assert.equal(await live.locator('[data-fx="text-reveal"]').count(), 1);
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/health`)).json()).pid, process.pid);
    await live.close();
  });
  await step('Upload an image using the media library', async () => {
    await page.getByRole('button', { name: 'Media library', exact: true }).click();
    await page.locator('#asset-file').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=', 'base64') });
    await page.getByRole('img', { name: 'pixel.png', exact: true }).waitFor();
    assert.equal(await page.getByRole('img', { name: 'pixel.png', exact: true }).evaluate(img => img.naturalWidth), 1);
    await idle();
    assert.equal(store.read().assets.length, 1);
  });
  await step('Inspect revisions and operational health from the studio', async () => {
    await page.getByRole('button', { name: 'Pages', exact: true }).click();
    await idle();
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await page.getByRole('heading', { name: 'Published revisions', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Restore draft', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Runtime', exact: true }).click();
    await page.getByRole('heading', { name: 'A clear view of your server.', exact: true }).waitFor();
    assert.match(await page.locator('body').innerText(), /Running normally/);
    assert.match(await page.locator('body').innerText(), /logs --follow/);
    await idle();
    await page.screenshot({ path: path.join(results, 'runtime-desktop.png'), fullPage: true });
  });
  await step('Keep the studio usable at mobile width without page overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Runtime overflows mobile width');
    await page.screenshot({ path: path.join(results, 'runtime-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: 'Pages', exact: true }).click();
    await idle();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Editor overflows mobile width');
    await page.screenshot({ path: path.join(results, 'studio-mobile.png'), fullPage: true });
  });
  assert.deepEqual(errors, [], 'Unexpected browser JavaScript errors');
  console.log(JSON.stringify({ passed: completed.length, screenshots: results, browserErrors: errors.length }));
} catch (error) {
  console.error(error);
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) { await page.screenshot({ path: path.join(results, 'browser-failure.png'), fullPage: true }).catch(() => {}); console.error((await page.locator('body').innerText()).slice(0, 2200)); }
  }
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await servers.close();
  await rm(dataDir, { recursive: true, force: true });
}
