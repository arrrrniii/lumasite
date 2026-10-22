// Small, progressive enhancements for the published, ordinary HTML pages.
// The native LumaFX runtime provides decorative and button effects.
const root = document.documentElement;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const menu = document.querySelector('#mobile-menu');
const menuTrigger = document.querySelector('[data-menu-open]');
const productTrigger = document.querySelector('[data-product-toggle]');
const productMenu = document.querySelector('#product-menu');
let menuTimer;

function finishLoading() {
  root.classList.remove('smo-loading');
  root.dataset.siteReady = 'true';
}

// Content is usable immediately. Artwork and native animations never gate it.
finishLoading();

function setProductMenu(open) {
  if (!productMenu || !productTrigger) return;
  productTrigger.setAttribute('aria-expanded', String(open));
  productMenu.hidden = !open;
  document.querySelector('.site-header')?.classList.toggle('menu-open', open);
}

productTrigger?.addEventListener('click', () => {
  setProductMenu(productTrigger.getAttribute('aria-expanded') !== 'true');
});
document.addEventListener('click', event => {
  if (!event.target.closest('.nav-product')) setProductMenu(false);
});
document.addEventListener('focusin', event => {
  if (!event.target.closest('.nav-product')) setProductMenu(false);
});

function openMenu() {
  if (!menu || menu.open) return;
  clearTimeout(menuTimer);
  menu.classList.remove('is-closing');
  setProductMenu(false);
  menu.showModal();
  root.classList.add('menu-is-open');
  menuTrigger?.setAttribute('aria-expanded', 'true');
  menu.querySelector('[data-menu-close]')?.focus({ preventScroll: true });
}

function closeMenu({ immediate = false, returnFocus = true } = {}) {
  if (!menu?.open) return;
  clearTimeout(menuTimer);
  menuTrigger?.setAttribute('aria-expanded', 'false');
  const finish = () => {
    menu.close();
    menu.classList.remove('is-closing');
    root.classList.remove('menu-is-open');
    if (returnFocus) menuTrigger?.focus({ preventScroll: true });
  };
  if (immediate || reducedMotion.matches) finish();
  else {
    menu.classList.add('is-closing');
    menuTimer = setTimeout(finish, 220);
  }
}

menuTrigger?.addEventListener('click', openMenu);
menu?.querySelector('[data-menu-close]')?.addEventListener('click', () => closeMenu());
menu?.addEventListener('cancel', event => {
  event.preventDefault();
  closeMenu();
});
menu?.addEventListener('keydown', event => {
  if (event.key !== 'Tab' || !menu.open) return;
  const focusable = [...menu.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
  if (!focusable.length) { event.preventDefault(); return; }
  const first = focusable[0], last = focusable.at(-1);
  if (event.shiftKey && (document.activeElement === first || !menu.contains(document.activeElement))) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !menu.contains(document.activeElement))) {
    event.preventDefault(); first.focus();
  }
});
menu?.addEventListener('close', () => {
  root.classList.remove('menu-is-open');
  menuTrigger?.setAttribute('aria-expanded', 'false');
});
menu?.addEventListener('click', event => {
  const link = event.target.closest('a[href]');
  if (!link) return;
  // A native dialog sits above every overlay, so close it before navigation.
  closeMenu({ immediate: true, returnFocus: false });
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && productTrigger?.getAttribute('aria-expanded') === 'true') {
    setProductMenu(false);
    productTrigger.focus();
  }
});
window.matchMedia('(min-width: 851px)').addEventListener('change', event => {
  if (event.matches) closeMenu({ immediate: true, returnFocus: false });
});

document.addEventListener('click', event => {
  const link = event.target.closest('a[href]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
  const destination = new URL(link.href, location.href);
  if (destination.origin !== location.origin || !/^https?:$/.test(destination.protocol)) return;
  if (destination.pathname === location.pathname && destination.search === location.search) return;
  setProductMenu(false);
  closeMenu({ immediate: true, returnFocus: false });
  // Let the browser start navigation now, with native history and fallbacks.
});

// Back/forward restores a usable page, including when served from bfcache.
window.addEventListener('pageshow', () => {
  root.classList.remove('is-navigating');
  closeMenu({ immediate: true, returnFocus: false });
  if (document.readyState === 'complete') finishLoading();
});

// Warm only known public pages after hover, keyboard focus, or touch intent.
// No prerendering: a prefetched page does not run scripts or record a pageview.
const siteHome = document.querySelector('.site-header .site-brand');
const siteBase = new URL(siteHome?.href || '/', location.href);
const publicPaths = new Set(['', 'product', 'campaigns', 'automations', 'pixel', 'inbox', 'developers', 'pricing', 'resources']
  .map(slug => new URL(slug, siteBase).pathname.replace(/\/$/, '')));
const warmedPages = new Set();
let intentTimer;
const reducedData = window.matchMedia('(prefers-reduced-data: reduce)');
function prefetchAllowed() {
  const connection = navigator.connection;
  return !reducedData.matches && !connection?.saveData && !['slow-2g', '2g'].includes(connection?.effectiveType) && !document.hidden;
}
function warmPage(link) {
  if (!prefetchAllowed() || !link || link.hasAttribute('download') || (link.target && link.target !== '_self') || link.relList.contains('nofollow') || warmedPages.size >= 6) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin || url.search || !publicPaths.has(url.pathname.replace(/\/$/, '')) || url.pathname.replace(/\/$/, '') === location.pathname.replace(/\/$/, '')) return;
  url.hash = '';
  if (warmedPages.has(url.href)) return;
  warmedPages.add(url.href);
  if (HTMLScriptElement.supports?.('speculationrules')) {
    const rule = document.createElement('script');
    rule.type = 'speculationrules';
    rule.dataset.sitePrefetch = url.pathname;
    rule.textContent = JSON.stringify({ prefetch: [{ source: 'list', urls: [url.href] }] });
    document.head.append(rule);
  } else {
    const hint = document.createElement('link');
    hint.rel = 'prefetch';
    hint.as = 'document';
    hint.href = url.href;
    hint.dataset.sitePrefetch = url.pathname;
    document.head.append(hint);
  }
}
document.addEventListener('pointerover', event => {
  if (event.pointerType === 'touch') return;
  const link = event.target.closest('a[href]');
  if (!link || link.contains(event.relatedTarget)) return;
  clearTimeout(intentTimer);
  intentTimer = setTimeout(() => warmPage(link), 80);
});
document.addEventListener('pointerout', event => {
  const link = event.target.closest('a[href]');
  if (link && !link.contains(event.relatedTarget)) clearTimeout(intentTimer);
});
document.addEventListener('focusin', event => warmPage(event.target.closest('a[href]')));
document.addEventListener('pointerdown', event => warmPage(event.target.closest('a[href]')), { passive: true });

document.querySelector('[data-back-top]')?.addEventListener('click', event => {
  event.preventDefault();
  window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
  document.querySelector('.site-header .site-brand')?.focus({ preventScroll: true });
});

// Keep active-page cues useful in both domain-root and /sites/:slug previews.
document.querySelectorAll('.desktop-nav a, .mobile-menu nav a').forEach(link => {
  const url = new URL(link.href, location.href);
  if (url.origin === location.origin && url.pathname.replace(/\/$/, '') === location.pathname.replace(/\/$/, '')) {
    link.setAttribute('aria-current', 'page');
  }
});

// Product illustrations run only while visible. CSS provides a complete static
// composition for visitors who disable JavaScript or prefer reduced motion.
const scenes = [...document.querySelectorAll('.visual-scene')];
const visibleScenes = new Set();
function syncSceneMotion() {
  for (const scene of scenes) {
    scene.dataset.sceneActive = String(visibleScenes.has(scene) && !document.hidden && !reducedMotion.matches);
  }
}
if ('IntersectionObserver' in window) {
  const sceneObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.12) visibleScenes.add(entry.target);
      else visibleScenes.delete(entry.target);
    }
    syncSceneMotion();
  }, { threshold: [0, 0.12] });
  scenes.forEach(scene => sceneObserver.observe(scene));
}
reducedMotion.addEventListener('change', syncSceneMotion);
document.addEventListener('visibilitychange', syncSceneMotion);
window.addEventListener('pagehide', () => scenes.forEach(scene => { scene.dataset.sceneActive = 'false'; }));
window.addEventListener('pageshow', syncSceneMotion);

// Native text shimmer pauses outside the viewport and in background tabs.
const shimmerHeadings = [...document.querySelectorAll('main h2[data-fx~="shimmer"]')];
const visibleHeadings = new Set();
function syncHeadingMotion() {
  shimmerHeadings.forEach(heading => heading.toggleAttribute('data-fx-paused', document.hidden || reducedMotion.matches || !visibleHeadings.has(heading)));
}
if ('IntersectionObserver' in window) {
  const headingObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) visibleHeadings.add(entry.target);
      else visibleHeadings.delete(entry.target);
    }
    syncHeadingMotion();
  });
  shimmerHeadings.forEach(heading => headingObserver.observe(heading));
}
reducedMotion.addEventListener('change', syncHeadingMotion);
document.addEventListener('visibilitychange', syncHeadingMotion);
window.addEventListener('pagehide', () => shimmerHeadings.forEach(heading => heading.setAttribute('data-fx-paused', '')));
window.addEventListener('pageshow', syncHeadingMotion);
