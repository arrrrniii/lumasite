import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

// Public browsing only: this script never reads credentials, calls admin APIs,
// saves drafts, or publishes anything. Run it after publishing the website.
const configured = process.env.MARKETING_BASE_URL || 'http://localhost:4311/sites/sendmailos/';
const base = new URL(configured.endsWith('/') ? configured : `${configured}/`);
assert.ok(['http:', 'https:'].includes(base.protocol), 'MARKETING_BASE_URL must be an HTTP(S) website URL');
const results = path.resolve('test-results');
await mkdir(results, { recursive: true });
const routes = [
  ['', /SendMailOS/], ['product', /SendMailOS/], ['campaigns', /SendMailOS/],
  ['automations', /SendMailOS/], ['pixel', /SendMailOS/], ['inbox', /SendMailOS/],
  ['developers', /SendMailOS/], ['pricing', /SendMailOS/], ['resources', /SendMailOS/],
  ['blog', /SendMailOS/], ['blog/first-email-campaign-checklist', /SendMailOS/],
  ['blog/welcome-email-workflow', /SendMailOS/], ['blog/email-api-or-smtp', /SendMailOS/],
];
const errors = [];
const completed = [];
let browser;
let activePage;

const address = slug => new URL(slug, base).href;
async function step(name, fn) {
  await fn(); completed.push(name); console.log(`PASS ${name}`);
}
function observe(page) {
  activePage = page;
  page.setDefaultTimeout(12000);
  page.setDefaultNavigationTimeout(20000);
  page.on('pageerror', error => errors.push(`${page.url()}: ${error.message}`));
  page.on('response', response => {
    const request = response.request();
    if (response.status() >= 400 && ['script', 'stylesheet', 'font'].includes(request.resourceType())) {
      errors.push(`Failed ${request.resourceType()} (${response.status()}): ${response.url()}`);
    }
  });
}
async function ready(page) {
  await page.waitForFunction(() => document.documentElement.dataset.siteReady === 'true' && !document.documentElement.classList.contains('smo-loading'));
  await page.waitForFunction(() => !document.documentElement.classList.contains('is-navigating'));
  await page.evaluate(() => document.fonts.ready);
}
async function verifyImages(page) {
  const images = page.locator('main img');
  for (let i = 0; i < await images.count(); i++) {
    const image = images.nth(i);
    await image.scrollIntoViewIfNeeded();
    const handle = await image.elementHandle();
    await page.waitForFunction(img => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0, handle, { timeout: 15000 });
    await handle.dispose();
  }
}
async function verifyPage(page, slug, { javascript = true } = {}) {
  const response = await page.goto(address(slug), { waitUntil: 'domcontentloaded' });
  assert.equal(response?.status(), 200, `Published /${slug} responds successfully`);
  assert.match(await page.title(), routes.find(([path]) => path === slug)[1]);
  assert.equal(await page.locator('main').count(), 1, `/${slug} has one main landmark`);
  assert.equal(await page.locator('main h1').count(), 1, `/${slug} has one primary heading`);
  assert.ok((await page.locator('main h1').innerText()).trim().length > 8, `/${slug} has meaningful heading text`);
  if (javascript) await ready(page);
  else await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check('500 20px Sora') && document.fonts.check('400 16px "DM Sans"')), true, `/${slug} loads both self-hosted font families`);
  await verifyImages(page);
  const svgProblems = await page.evaluate(() => {
    const problems = [];
    const allIds = [...document.querySelectorAll('[id]')].map(element => element.id);
    if (new Set(allIds).size !== allIds.length) problems.push('Duplicate document IDs');
    for (const svg of document.querySelectorAll('svg.scene-svg')) {
      const labels = (svg.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
      if (svg.getAttribute('role') !== 'img' || labels.length < 2 || labels.some(id => !document.getElementById(id)?.textContent.trim())) problems.push('An illustration has an incomplete accessible description');
    }
    return problems;
  });
  assert.deepEqual(svgProblems, [], `/${slug} has complete, uniquely identified illustrations`);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await assertNoOverflow(page, slug);
}
async function assertNoOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(dimensions.document <= dimensions.viewport + 1 && dimensions.body <= dimensions.viewport + 1,
    `${label} overflows horizontally: ${JSON.stringify(dimensions)}`);
}
async function finishFiniteAnimations(locator) {
  await locator.evaluate(async element => {
    const animations = element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity);
    await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
  });
}
async function revealForScreenshot(page) {
  await page.evaluate(async () => {
    const step = Math.max(250, Math.floor(innerHeight * 0.75));
    for (let top = 0; top < document.documentElement.scrollHeight; top += step) {
      window.scrollTo({ top, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
  });
  await finishFiniteAnimations(page.locator('body'));
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await finishFiniteAnimations(page.locator('body'));
}
async function openMenu(page) {
  const trigger = page.getByRole('button', { name: 'Open menu', exact: true });
  await trigger.click();
  await page.waitForFunction(() => document.querySelector('#mobile-menu')?.open === true);
  const menu = page.locator('#mobile-menu');
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('menu-is-open')), true, 'Menu locks page scrolling');
  const lock = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement), body = getComputedStyle(document.body);
    return ['hidden', 'clip'].includes(root.overflowY) || ['hidden', 'clip'].includes(body.overflowY) || body.position === 'fixed';
  });
  assert.equal(lock, true, 'An open menu applies a real scroll lock');
  const box = await menu.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box && box.x <= 1 && box.y <= 1 && box.width >= viewport.width - 1 && box.height >= viewport.height - 1,
    `Menu fills the mobile viewport: ${JSON.stringify(box)}`);
  return { menu, trigger };
}
async function closeMenuWithEscape(page, trigger) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#mobile-menu')?.open === false);
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('menu-is-open')), false, 'Closing menu releases its scroll lock');
  assert.equal(await trigger.evaluate(element => document.activeElement === element), true, 'Escape restores focus to the menu trigger');
}

try {
  browser = await chromium.launch({ headless: true });
  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const desktop = await desktopContext.newPage(); observe(desktop);
  await step('All thirteen published routes load at desktop width with working images and no overflow', async () => {
    for (const [slug] of routes) await verifyPage(desktop, slug);
    await verifyPage(desktop, '');
    await revealForScreenshot(desktop);
    await desktop.screenshot({ path: path.join(results, 'marketing-home-desktop.png'), fullPage: true });
  });

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference', isMobile: true, hasTouch: true });
  const mobile = await mobileContext.newPage(); observe(mobile);
  await step('All thirteen published routes work at 390px with normal motion and no overflow', async () => {
    for (const [slug] of routes) await verifyPage(mobile, slug);
    await verifyPage(mobile, '');
    await revealForScreenshot(mobile);
    await mobile.screenshot({ path: path.join(results, 'marketing-home-mobile.png'), fullPage: true });
  });

  await step('SVG product motion runs in view, pauses offscreen, and remains legible on the dark theme', async () => {
    const scene = mobile.locator('.visual-scene').first();
    assert.ok(await mobile.locator('.scene-svg').count() >= 3, 'Homepage retains three native SVG product explanations');
    await scene.scrollIntoViewIfNeeded();
    await mobile.waitForFunction(() => document.querySelector('.visual-scene')?.dataset.sceneActive === 'true');
    assert.ok(await scene.evaluate(element => element.getAnimations({ subtree: true }).some(animation => animation.playState === 'running')), 'In-view illustration is animated');
    const contrasts = await mobile.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
      const context = canvas.getContext('2d');
      function luminance(color) {
        context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
        const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; });
        return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
      }
      const ratio = (foreground, background) => { const a = luminance(foreground), b = luminance(background); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
      const body = getComputedStyle(document.body), caption = getComputedStyle(document.querySelector('.scene-sample-label')), panel = getComputedStyle(document.querySelector('.visual-scene .visual-topline')), button = getComputedStyle(document.querySelector('.button.lime'));
      return { body: ratio(body.color, body.backgroundColor), previewCaption: ratio(caption.color, panel.backgroundColor), primaryButton: ratio(button.color, button.backgroundColor) };
    });
    for (const [name, ratio] of Object.entries(contrasts)) assert.ok(ratio >= 4.5, `${name} text contrast is readable (${ratio.toFixed(2)}:1)`);
    await mobile.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await mobile.waitForFunction(() => document.querySelector('.visual-scene')?.dataset.sceneActive === 'false');
    assert.equal(await scene.evaluate(element => element.getAnimations({ subtree: true }).some(animation => animation.playState === 'running')), false, 'Offscreen illustration pauses its animations');
  });

  await step('Mobile fullscreen menu traps focus and Escape restores focus and scrolling', async () => {
    const { menu, trigger } = await openMenu(mobile);
    await finishFiniteAnimations(menu);
    await mobile.screenshot({ path: path.join(results, 'marketing-menu-mobile.png'), fullPage: false });
    for (let i = 0; i < 20; i++) {
      await mobile.keyboard.press(i < 16 ? 'Tab' : 'Shift+Tab');
      assert.equal(await menu.evaluate(element => element.contains(document.activeElement)), true, `Focus remains in dialog after tab ${i + 1}`);
    }
    for (const name of ['Resources', 'Documentation', 'Log in']) {
      assert.equal(await menu.getByRole('link', { name, exact: true }).count(), 1, `Mobile menu retains ${name}`);
    }
    await closeMenuWithEscape(mobile, trigger);
    await assertNoOverflow(mobile, 'Menu closed');
  });

  await step('Menu navigation, browser back, and a footer destination remain usable', async () => {
    const { menu } = await openMenu(mobile);
    await Promise.all([
      mobile.waitForURL(address('campaigns')),
      menu.getByRole('link', { name: 'Campaigns', exact: true }).click(),
    ]);
    await ready(mobile);
    assert.match(await mobile.title(), /campaigns/i);
    await mobile.goBack({ waitUntil: 'domcontentloaded' });
    await mobile.waitForURL(address(''));
    await ready(mobile);
    const restored = await openMenu(mobile);
    await closeMenuWithEscape(mobile, restored.trigger);
    const pricing = mobile.locator('footer').getByRole('link', { name: 'Pricing', exact: true });
    await Promise.all([mobile.waitForURL(address('pricing')), pricing.click()]);
    await ready(mobile);
    assert.match(await mobile.title(), /pricing/i);
    await assertNoOverflow(mobile, 'Pricing after footer navigation');
  });

  const reducedContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', isMobile: true, hasTouch: true });
  const reduced = await reducedContext.newPage(); observe(reduced);
  await step('Reduced motion preserves menu controls and ordinary page navigation', async () => {
    await verifyPage(reduced, '');
    let opened = await openMenu(reduced);
    await closeMenuWithEscape(reduced, opened.trigger);
    opened = await openMenu(reduced);
    await Promise.all([
      reduced.waitForURL(address('developers')),
      opened.menu.getByRole('link', { name: 'Developers & MCP', exact: true }).click(),
    ]);
    await ready(reduced);
    assert.equal(await reduced.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
    const illustration = reduced.locator('.visual-scene').first();
    await illustration.scrollIntoViewIfNeeded();
    assert.equal(await illustration.evaluate(element => element.getAnimations({ subtree: true }).some(animation => animation.playState === 'running')), false, 'Reduced-motion illustration stays static');
    await assertNoOverflow(reduced, 'Reduced-motion developer page');
  });

  const noJsContext = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  const noJs = await noJsContext.newPage(); observe(noJs);
  await step('JavaScript-disabled visitors can read the site and use fallback navigation', async () => {
    await verifyPage(noJs, '', { javascript: false });
    const fallback = noJs.getByRole('navigation', { name: 'Website navigation', exact: true });
    assert.equal(await fallback.isVisible(), true, 'No-JavaScript navigation remains visible');
    assert.equal(await noJs.locator('main h1').isVisible(), true);
    assert.ok(await noJs.locator('.scene-svg').count() > 0, 'Illustrations remain part of the document without JavaScript');
    await Promise.all([
      noJs.waitForURL(address('product')),
      fallback.getByRole('link', { name: 'Product', exact: true }).click(),
    ]);
    assert.match(await noJs.title(), /SendMailOS/);
    assert.equal(await noJs.locator('main h1').isVisible(), true);
    await assertNoOverflow(noJs, 'JavaScript-disabled product page');
  });

  assert.deepEqual(errors, [], 'No browser JavaScript errors or failed runtime styles/scripts');
  console.log(JSON.stringify({ passed: completed.length, routes: routes.length, browserErrors: errors.length, screenshots: results, baseURL: base.href }));
} catch (error) {
  console.error(error);
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: path.join(results, 'marketing-failure.png'), fullPage: true }).catch(() => {});
    console.error(`Page: ${activePage.url()}`);
    console.error((await activePage.locator('body').innerText().catch(() => '')).slice(0, 1600));
  }
  if (errors.length) console.error(JSON.stringify({ browserErrors: errors }, null, 2));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
