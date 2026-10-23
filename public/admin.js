/* LumaSite studio: native browser modules, no build step and no embedded website code. */
(() => {
  'use strict';

  const app = document.getElementById('app');
  const notifications = document.getElementById('notifications');
  const state = {
    configured: true, authenticated: false, busy: false, version: '',
    port: 4310, sitePort: 4311, projects: [], project: null, urls: null,
    pages: [], page: null, baseline: '', dirty: false, view: 'projects',
    sourceTab: 'html', device: 'desktop', previewUrl: '', previewError: '',
    library: null, libraryTab: 'components', assets: [], revisions: [],
    diagnostics: null, health: null, readiness: null, modal: null,
    formError: '', projectTokens: new Map(), importFile: null, menuOpen: false,
  };
  let toastTimer;
  let previewResizeObserver;

  function fitPreview() {
    const wrap = document.getElementById('preview-wrap');
    const frame = wrap?.querySelector('iframe');
    if (!frame) return;
    const width = { desktop: 1280, tablet: 768, mobile: 375 }[state.device] || 1280;
    const available = wrap.parentElement.clientWidth - parseFloat(getComputedStyle(wrap.parentElement).paddingLeft) - parseFloat(getComputedStyle(wrap.parentElement).paddingRight);
    wrap.style.width = `${Math.min(width, available)}px`;
    const scale = Math.min(1, wrap.clientWidth / width);
    frame.style.width = `${width}px`;
    frame.style.height = `${Math.max(430, wrap.clientHeight) / scale}px`;
    frame.style.transform = `scale(${scale})`;
  }

  const paths = {
    overview: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>',
    map: '<rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v5M5 17v-5h14v5"/>',
    rss: '<path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>',
    chevron: '<path d="m8 10 4 4 4-4"/>',
    arrow: '<path d="m9 5 7 7-7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    pages: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    layers: '<path d="m12 3 10 5-10 5L2 8Z"/><path d="m2 12 10 5 10-5M2 16l10 5 10-5"/>',
    connect: '<path d="M10 13a5 5 0 0 0 7 .2l3-3a5 5 0 0 0-7-7l-2 2"/><path d="M14 11a5 5 0 0 0-7-.2l-3 3a5 5 0 0 0 7 7l2-2"/>',
    pulse: '<path d="M2 12h4l3-8 6 16 3-8h4"/>',
    external: '<path d="M15 3h6v6M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
    upload: '<path d="M12 16V3m-5 5 5-5 5 5M3 16v4a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-4"/>',
    download: '<path d="M12 3v13m-5-5 5 5 5-5M3 16v4a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-4"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.1 8a8 8 0 0 1 13.2-3L20 7M4 17l1.7 2A8 8 0 0 0 18.9 16"/>',
    desktop: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    tablet: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M11 18h2"/>',
    mobile: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
    code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18"/>',
    history: '<path d="M3 3v5h5"/><path d="M3.8 8a9 9 0 1 1-.5 7"/><path d="M12 7v5l3 2"/>',
    rocket: '<path d="M9 15 5 19m4-4-4-4 5-3c1-4 5-6 11-5 1 6-1 10-5 11l-3 5-4-4Z"/><circle cx="16" cy="8" r="1"/><path d="m4 16-1 5 5-1"/>',
    logout: '<path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4M15 7l5 5-5 5M8 12h12"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    sparkle: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4M18 4h4"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    video: '<rect x="2" y="5" width="14" height="14" rx="2"/><path d="m16 10 6-4v12l-6-4"/>',
    audio: '<path d="M9 18V5l12-2v13M9 8l12-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="16" rx="3" ry="3"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h9V3"/>',
  };

  function icon(name, className = '') {
    return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.code}</svg>`;
  }

  function escape(value = '') {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function url(value, { separateOrigin = false } = {}) {
    try {
      const parsed = new URL(value, window.location.origin);
      if (!['http:', 'https:'].includes(parsed.protocol)) return '';
      if (separateOrigin && parsed.origin === window.location.origin) return '';
      return parsed.href;
    } catch { return ''; }
  }

  function external(value, label, classes = 'external-link') {
    const safe = url(value);
    return safe ? `<a class="${classes}" href="${escape(safe)}" target="_blank" rel="noopener noreferrer">${escape(label)}${icon('external')}</a>` : '';
  }

  function copyField(value, label = 'Copy', secret = false) {
    return `<div class="copy-field">${secret ? `<input class="mono" aria-label="Project MCP token" type="password" readonly value="${escape(value)}">` : `<code>${escape(value)}</code>`}<button class="btn small" data-action="copy" data-copy="${escape(value)}" type="button">${icon('copy')}${label}</button></div>`;
  }

  // Every resource is resolved within the selected website, including installations
  // that use /sites/:slug/ instead of a production hostname.
  function websiteResources() {
    const resource = (path, label, symbol, key) => ({ path, label, symbol, key });
    return [resource('', 'Website', 'globe', 'website'), resource('sitemap.xml', 'XML sitemap', 'map', 'sitemap'), resource('robots.txt', 'Robots.txt', 'pages', 'robots'), resource('feed.xml', 'RSS feed', 'rss', 'rss')];
  }

  function resourceUrl(base, path = '') {
    const safe = url(base || '');
    if (!base || !safe) return '';
    return url(new URL(path, safe.endsWith('/') ? safe : `${safe}/`).href);
  }

  function addressRow(value, label, symbol = 'globe', context = '') {
    const safe = value ? url(value) : '';
    if (!safe) return '';
    const accessible = `${context ? `${context} ` : ''}${label}`;
    return `<div class="address-row"><span class="address-icon">${icon(symbol)}</span><div class="address-text"><span>${escape(label)}</span><a href="${escape(safe)}" target="_blank" rel="noopener noreferrer" title="${escape(safe)}">${escape(safe)}</a></div><div class="address-actions"><a class="btn icon-only" href="${escape(safe)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escape(accessible)}" title="Open ${escape(accessible)}">${icon('external')}</a><button class="btn icon-only" data-action="copy" data-copy="${escape(safe)}" type="button" aria-label="Copy ${escape(accessible)} URL" title="Copy ${escape(accessible)} URL">${icon('copy')}</button></div></div>`;
  }

  function environmentLinks(production = false) {
    const base = production ? state.urls?.production : state.urls?.site;
    const name = production ? 'Production' : 'Preview';
    return `<section class="link-environment" data-environment="${name.toLowerCase()}"><div class="environment-heading"><span class="eyebrow">${name}</span><span class="pill ${production ? '' : 'success'}">${production ? 'Configured domain' : 'Published pages'}</span></div>${base ? websiteResources().map((item) => `<div data-resource="${item.key}">${addressRow(resourceUrl(base, item.path), item.label, item.symbol, name.toLowerCase())}</div>`).join('') : `<div class="empty-links">${icon('globe')}<p>Add your domain in Website settings below.</p><span class="hint">Your preview links are ready to use.</span></div>`}</section>`;
  }

  function quickLinks() {
    if (!state.project) return '';
    return `<details class="quick-links"><summary class="btn small">${icon('connect')}Quick links${icon('chevron')}</summary><div class="quick-links-menu"><span class="eyebrow">Published preview</span>${websiteResources().map((item) => external(resourceUrl(state.urls?.site, item.path), item.label, 'quick-link')).join('')}${state.urls?.production ? `<span class="eyebrow">Configured domain</span>${external(state.urls.production, 'Production website', 'quick-link')}` : ''}<button class="quick-link" data-action="navigate" data-view="connections" type="button">All links & settings${icon('arrow')}</button></div></details>`;
  }

  function draftLinks() {
    const preview = url(state.previewUrl, { separateOrigin: true });
    return preview ? `${external(preview, 'Open draft', 'btn small')}<button class="btn small" data-action="copy" data-copy="${escape(preview)}" type="button" aria-label="Copy private draft URL">${icon('copy')}</button>` : '';
  }

  function pagePayload(page = state.page, validate = false) {
    if (!page) return {};
    const { title = '', slug = '', description = '', html = '', css = '', js = '' } = page;
    const seo = { ...(page.seo || {}) };
    if (page._seoJson !== undefined) {
      if (validate) {
        try { seo.structuredData = page._seoJson.trim() ? JSON.parse(page._seoJson) : null; }
        catch { throw new Error('Structured data must be valid JSON before saving.'); }
      } else seo.structuredData = page._seoJson;
    }
    return { title, slug, description, html, css, js, seo };
  }

  function markClean() {
    state.baseline = JSON.stringify(pagePayload());
    state.dirty = false;
  }

  function updateDirty() {
    state.dirty = JSON.stringify(pagePayload()) !== state.baseline;
    const indicator = document.getElementById('draft-status');
    if (indicator) {
      indicator.className = `status-inline${state.dirty ? ' dirty' : ''}`;
      indicator.innerHTML = `<span class="dot"></span>${state.dirty ? 'Unsaved changes' : 'Draft saved'}`;
    }
    const save = document.querySelector('[data-action="save"]');
    if (save && !state.busy) save.disabled = !state.dirty;
    const count = document.getElementById('source-count');
    if (count && state.page) count.textContent = state.sourceTab === 'settings' ? 'SEO and URL' : `${String(state.page[state.sourceTab] || '').split('\n').length} lines`;
  }

  async function api(path, options = {}) {
    const { responseType, ...requestOptions } = options;
    const headers = new Headers(requestOptions.headers || {});
    const init = { credentials: 'same-origin', ...requestOptions, headers };
    if (['POST', 'PUT', 'PATCH'].includes(init.method) && init.body === undefined) init.body = {};
    if (init.body && !(init.body instanceof Blob) && !(init.body instanceof ArrayBuffer)) {
      headers.set('Content-Type', 'application/json');
      init.body = JSON.stringify(init.body);
    }
    let response;
    try { response = await fetch(path, init); }
    catch { throw new Error('The server cannot be reached. Check that LumaSite is running, then try again.'); }
    if (response.ok && responseType === 'blob') return { blob: await response.blob(), disposition: response.headers.get('Content-Disposition') || '' };
    let data;
    try { data = await response.json(); }
    catch { data = {}; }
    if (!response.ok) {
      const error = new Error(data.error || `The request failed (${response.status}). Check the server logs and try again.`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function toast(message, error = false) {
    clearTimeout(toastTimer);
    notifications.innerHTML = `<div class="toast${error ? ' error' : ''}" role="status">${icon(error ? 'info' : 'check')}<span>${escape(message)}</span></div>`;
    toastTimer = setTimeout(() => { notifications.innerHTML = ''; }, error ? 10000 : 5000);
  }

  function applyBusyUI() {
    app.setAttribute('aria-busy', String(state.busy));
    if (state.busy) {
      if (!document.getElementById('busy-bar')) {
        const bar = document.createElement('div');
        bar.className = 'loading-bar'; bar.id = 'busy-bar'; bar.setAttribute('aria-hidden', 'true');
        document.body.appendChild(bar);
      }
      app.querySelectorAll('button, input, textarea, select').forEach((element) => {
        if (!element.disabled) { element.dataset.busyDisabled = 'true'; element.disabled = true; }
      });
    } else {
      document.getElementById('busy-bar')?.remove();
      app.querySelectorAll('[data-busy-disabled]').forEach((element) => { element.disabled = false; delete element.dataset.busyDisabled; });
      updateDirty();
    }
  }

  async function run(action) {
    if (state.busy) return;
    state.busy = true;
    state.formError = '';
    applyBusyUI();
    try { await action(); }
    catch (error) {
      state.formError = error.message;
      const errorSlot = document.getElementById('form-error');
      if (errorSlot) { errorSlot.hidden = false; errorSlot.textContent = error.message; }
      toast(error.message, true);
    } finally { state.busy = false; applyBusyUI(); }
  }

  function discardDraft() {
    return !state.dirty || window.confirm('Discard your unsaved changes? Save the draft first if you want to keep them.');
  }

  function brand() {
    return '<a class="brand" href="/admin" data-action="home"><span class="brand-symbol" aria-hidden="true">L</span>LumaSite</a>';
  }

  function authView() {
    const setup = !state.configured;
    document.title = `${setup ? 'Set up your studio' : 'Sign in'} · LumaSite`;
    return `<div class="auth-layout">
      <section class="auth-story">${brand()}<div class="auth-story-copy"><h1>Your websites.<br>Your rules.</h1><p>A website studio with LumaFX built in. Design, publish, and connect your own tools.</p></div><p class="auth-story-footer">Self hosted. Yours from the first page.</p></section>
      <main class="auth-content" id="main"><div class="auth-form"><h2>${setup ? 'Make yourself at home.' : 'Welcome back.'}</h2><p>${setup ? 'Set an admin password to open your LumaSite studio.' : 'Sign in to your website studio.'}</p>
      <form data-form="${setup ? 'setup' : 'login'}"><div id="form-error" class="form-error" hidden></div>
      <label>Admin password<input type="password" name="password" autocomplete="${setup ? 'new-password' : 'current-password'}" required ${setup ? 'minlength="12"' : ''} autofocus placeholder="${setup ? 'At least 12 characters' : 'Enter your password'}"></label>
      ${setup ? `<label>Public studio URL<input name="publicUrl" type="url" value="${escape(window.location.origin)}" readonly><small>Set an external address with the CLI during initialization.</small></label>` : ''}
      <button class="btn primary" type="submit">${setup ? 'Create your studio' : 'Open studio'}${icon('arrow')}</button></form>
      <p class="hint">${setup ? `Admin port ${escape(state.port)} · Website port ${escape(state.sitePort)}. You can change server settings from the CLI.` : 'Lost your password? Run <code>node bin/lumasite.mjs credentials</code> on your server to view the saved installation credentials.'}</p></div></main></div>`;
  }

  function navButton(view, label, symbol, extra = '') {
    return `<button data-action="navigate" data-view="${view}" class="${state.view === view ? 'active' : ''} ${extra}" type="button" ${state.view === view ? 'aria-current="page"' : ''}>${icon(symbol)}${label}</button>`;
  }

  function rail() {
    return `<aside class="rail" id="studio-navigation" aria-label="Studio navigation"><div class="rail-brand">${brand()}<button class="btn icon-only mobile-control" data-action="toggle-menu" type="button" aria-label="Close navigation">${icon('close')}</button></div><div class="rail-content"><div><p class="rail-label">Workspace</p><div class="project-picker"><select id="project-select" aria-label="Select website"><option value="">All websites</option>${state.projects.map((project) => `<option value="${escape(project.id)}" ${project.id === state.project?.id ? 'selected' : ''}>${escape(project.name)}</option>`).join('')}</select><button class="new-project" data-action="new-project" type="button">${icon('plus')}New website</button></div></div>
      <div><p class="rail-label">Website studio</p><nav class="rail-nav" aria-label="Website studio">${state.project ? `${navButton('overview', 'Overview', 'overview')}${navButton('pages', 'Pages', 'pages')}${navButton('media', 'Media library', 'image')}${navButton('library', 'Components', 'layers')}${navButton('connections', 'Connections', 'connect')}` : navButton('projects', 'Your websites', 'folder')}${navButton('runtime', 'Runtime', 'pulse')}</nav></div></div>
      <div class="rail-footer"><div class="rail-native">${icon('sparkle')}<div><strong>Made to move.</strong><span>LumaFX is built into every page.</span></div></div><div class="rail-footer-meta"><span>LumaSite ${escape(state.version ? `v${state.version}` : '')}</span>${icon('lock')}</div></div></aside>`;
  }

  function shell() {
    const titles = { projects: 'Your websites', overview: 'Overview', pages: 'Pages', media: 'Media library', library: 'Components', connections: 'Connections', runtime: 'Runtime' };
    document.title = `${state.project?.name ? `${state.project.name} · ` : ''}${titles[state.view] || 'Studio'} · LumaSite`;
    return `<div class="shell">${rail()}<button class="nav-scrim" data-action="toggle-menu" type="button" aria-label="Close navigation" tabindex="-1"></button><div class="content"><header class="topbar"><div class="topbar-left"><button class="btn icon-only mobile-control" id="menu-trigger" data-action="toggle-menu" type="button" aria-label="Open navigation" aria-controls="studio-navigation" aria-expanded="${state.menuOpen}">${icon('menu')}</button><div class="breadcrumb"><span>Studio</span>${icon('arrow')}${state.project ? `<strong>${escape(state.project.name)}</strong>${icon('arrow')}` : ''}<span>${titles[state.view] || 'Studio'}</span></div></div><div class="topbar-right">${quickLinks()}${state.project ? external(state.urls?.site, 'Preview website', 'btn small topbar-preview') : ''}<button class="btn icon-only" data-action="import-zip" type="button" aria-label="Import ZIP" title="Import ZIP">${icon('upload')}</button><button class="btn icon-only" data-action="logout" type="button" aria-label="Sign out" title="Sign out">${icon('logout')}</button></div></header><main class="workspace" id="main" tabindex="-1">${workspaceView()}</main><footer class="workspace-footer"><span>${icon('lock')}Private studio</span><span>Design. Connect. Publish.</span></footer></div></div>${modalView()}`;
  }

  function workspaceView() {
    if (state.view === 'runtime') return runtimeView();
    if (!state.project) return projectsView();
    if (state.view === 'overview') return overviewView();
    if (state.view === 'media') return mediaView();
    if (state.view === 'library') return libraryView();
    if (state.view === 'connections') return connectionsView();
    return editorView();
  }

  function render() {
    previewResizeObserver?.disconnect();
    const wasMenuOpen = state.menuOpen;
    if (state.modal) state.menuOpen = false;
    app.innerHTML = state.authenticated ? shell() : authView();
    syncNavigation();
    const dialog = document.querySelector('dialog');
    if (dialog && !dialog.open) { dialog.showModal(); dialog.querySelector('input, button')?.focus(); }
    else if (wasMenuOpen && !state.menuOpen) document.getElementById('main')?.focus();
    applyBusyUI();
    const canvas = document.querySelector('.preview-canvas');
    if (canvas) { previewResizeObserver = new ResizeObserver(fitPreview); previewResizeObserver.observe(canvas); requestAnimationFrame(fitPreview); }
  }

  function syncNavigation() {
    const mobile = matchMedia('(max-width: 900px)').matches;
    const open = mobile && state.menuOpen;
    document.querySelector('.shell')?.classList.toggle('navigation-open', open);
    document.body.classList.toggle('navigation-open', open);
    const rail = document.getElementById('studio-navigation');
    if (rail) { rail.inert = mobile && !open; rail.setAttribute('aria-hidden', String(mobile && !open)); }
    const content = document.querySelector('.content');
    if (content) content.inert = open;
    document.getElementById('menu-trigger')?.setAttribute('aria-expanded', String(open));
  }

  function overviewView() {
    const published = state.pages.filter((page) => page.publishedRevisionId).length;
    const recent = [...state.pages].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, 6);
    return `<div class="page-heading"><div><span class="eyebrow">Website overview</span><h1>${escape(state.project.name)}</h1><p>Your pages, connections, and publishing tools in one place.</p></div><div class="heading-actions"><button class="btn" data-action="project-export-zip" type="button">${icon('download')}Export ZIP</button><button class="btn primary" data-action="navigate" data-view="pages" type="button">${icon('pages')}Edit pages</button></div></div>
      <section class="overview-summary" aria-label="Website summary"><div class="overview-identity"><span class="project-avatar">${escape(state.project.name?.slice(0, 1).toUpperCase() || 'W')}</span><div><strong>${escape(state.project.domain || state.project.slug)}</strong><span>${state.project.domain ? 'Configured domain · DNS and HTTPS managed on your server' : 'Add a domain in Connections when you are ready'}</span></div></div><dl class="overview-stats"><div><dt>Total pages</dt><dd>${state.pages.length}</dd></div><div><dt>Published</dt><dd>${published}</dd></div><div><dt>Unpublished</dt><dd>${state.pages.length - published}</dd></div></dl></section>
      <div class="overview-grid"><section class="surface page-directory"><div class="surface-header"><div><h2>Recent pages</h2><p>Pick up where you left off.</p></div><button class="btn small" data-action="new-page" type="button">${icon('plus')}New page</button></div>${recent.length ? `<div class="page-directory-label"><span>Page</span><span>Status</span></div>${recent.map((page) => `<button class="page-directory-row" type="button" data-action="select-page" data-id="${escape(page.id)}"><span class="page-directory-icon">${icon('pages')}</span><span class="page-directory-name"><strong>${escape(page.title || 'Untitled page')}</strong><small>/${escape(page.slug || '')}</small></span><span class="pill ${page.publishedRevisionId ? 'success' : ''}">${page.publishedRevisionId ? 'Published' : 'Draft'}</span>${icon('arrow')}</button>`).join('')}` : '<p class="hint">Create your first page to start publishing.</p>'}<button class="text-button" data-action="navigate" data-view="pages" type="button">View all ${state.pages.length} pages${icon('arrow')}</button></section>
      <section class="surface overview-links"><div class="surface-header"><div><h2>Website links</h2><p>Published pages on this server.</p></div>${icon('globe')}</div>${websiteResources().map((item) => addressRow(resourceUrl(state.urls?.site, item.path), item.label, item.symbol, 'preview')).join('')}<button class="text-button" data-action="navigate" data-view="connections" type="button">All addresses & settings${icon('arrow')}</button></section></div>
      <section class="studio-shortcuts" aria-label="Studio tools">${[['media', 'image', 'Your media, ready to use', 'Upload and manage images, video, and audio.'], ['library', 'sparkle', 'Build with LumaFX', 'Reusable sections and native animation recipes.'], ['connections', 'connect', 'Connect your tools', 'MCP access, domains, and SEO defaults.']].map(([view, symbol, title, description]) => `<button data-action="navigate" data-view="${view}" type="button"><span class="shortcut-icon">${icon(symbol)}</span><span><strong>${title}</strong><small>${description}</small></span>${icon('arrow')}</button>`).join('')}</section>`;
  }

  function projectForm() {
    return `<form data-form="project"><div id="form-error" class="form-error" hidden></div><label>Website name<input name="name" required maxlength="100" placeholder="SendMailOS" autocomplete="off"></label><label>Website domain<input name="domain" placeholder="sendmailos.com" autocomplete="off" autocapitalize="off" spellcheck="false"><small>You can connect a domain later. A local website URL is ready immediately.</small></label><button class="btn primary" type="submit">${icon('plus')}Create website</button></form>`;
  }

  function projectsView() {
    return `<div class="page-heading"><div><h1>Your websites</h1><p>Each website gets its own pages, media library, and MCP connection.</p></div>${state.projects.length ? '<button class="btn primary" data-action="new-project" type="button">' + icon('plus') + 'New website</button>' : ''}</div>
      ${!state.projects.length ? `<section class="first-project"><div class="first-project-copy"><span class="brand-symbol" aria-hidden="true">L</span><h2>A new home for your next idea.</h2><p>Give your website a name. LumaSite will prepare a homepage, its own address, and your MCP connection.</p><span class="pill violet">${icon('sparkle')}LumaFX included</span></div><div class="first-project-form"><h2>Create your first website</h2>${projectForm()}</div></section>` : `<section class="project-card-list" aria-label="Your websites">${state.projects.map((project) => `<button class="project-card" type="button" data-action="select-project" data-id="${escape(project.id)}"><span class="project-avatar">${escape(project.name?.slice(0, 1).toUpperCase() || 'W')}</span><div><h3>${escape(project.name)}</h3><p>${escape(project.domain || project.urls?.site || project.slug)}</p></div>${icon('arrow')}</button>`).join('')}</section>`}`;
  }

  function pageList() {
    return `<aside class="page-rail"><div class="page-rail-title"><span>Website pages <span class="muted">(${state.pages.length})</span></span><button class="btn icon-only" data-action="new-page" type="button" aria-label="Add page">${icon('plus')}</button></div><nav class="page-list" aria-label="Pages">${state.pages.map((page) => `<button class="page-item${page.id === state.page?.id ? ' active' : ''}" type="button" data-action="select-page" data-id="${escape(page.id)}" ${page.id === state.page?.id ? 'aria-current="page"' : ''}>${icon('pages')}<span><strong class="page-item-title" title="${escape(page.title || 'Untitled page')}">${escape(page.title || 'Untitled page')}</strong><small>/${escape(page.slug || '')}</small></span>${page.publishedRevisionId ? '<span class="dot" title="Published" style="color:#65a283"></span>' : ''}</button>`).join('')}</nav></aside>`;
  }

  function editorView() {
    return `<div class="page-heading"><div><h1>${escape(state.project.name)}</h1><p>${state.urls?.site ? external(state.urls.site, state.project.domain || state.urls.site) : 'Your website studio'}</p></div><div class="heading-actions">${state.page ? `<span class="status-inline${state.dirty ? ' dirty' : ''}" id="draft-status"><span class="dot"></span>${state.dirty ? 'Unsaved changes' : 'Draft saved'}</span><button class="btn" type="button" data-action="save" ${state.dirty ? '' : 'disabled'}>${icon('save')}Save draft</button><button class="btn primary" type="button" data-action="publish">${icon('rocket')}Publish page</button>` : `<button class="btn primary" type="button" data-action="new-page">${icon('plus')}New page</button>`}</div></div>
      <section class="studio">${pageList()}<div class="studio-body">${state.page ? `<header class="editor-top"><div class="editor-page-name"><h2>${escape(state.page.title || 'Untitled page')}</h2><span class="pill ${state.page.publishedRevisionId ? 'success' : ''}">${state.page.publishedRevisionId ? 'Published' : 'Draft'}</span></div><div class="row"><button class="btn subtle small" data-action="revisions" type="button">${icon('history')}History</button><button class="btn small violet" data-action="navigate" data-view="library" type="button">${icon('sparkle')}Add section</button></div></header><div class="editor-grid"><section class="preview-pane" aria-label="Page preview"><div class="preview-tools"><div class="preview-address">${icon('lock')}<span>Draft preview</span></div><div class="row" style="gap:2px">${['desktop', 'tablet', 'mobile'].map((device) => `<button class="btn icon-only${state.device === device ? ' active' : ''}" type="button" data-action="device" data-device="${device}" title="${device[0].toUpperCase() + device.slice(1)} preview" aria-label="${device} preview" aria-pressed="${state.device === device}">${icon(device)}</button>`).join('')}<button class="btn icon-only" type="button" data-action="preview" title="Save and refresh preview" aria-label="Save and refresh preview">${icon('refresh')}</button></div></div><div class="preview-canvas"><div class="preview-frame-wrap" data-device="${state.device}" id="preview-wrap">${previewContent()}</div></div><div class="preview-footer"><span>${icon('lock')}Private saved draft</span><div class="row draft-external-links">${draftLinks()}</div></div></section>${sourcePane()}</div>` : `<div class="empty-state">${icon('pages')}<h2>Your next page starts here.</h2><p>Create a page, add your sections, and bring it to life with LumaFX.</p><button class="btn primary" data-action="new-page" type="button">${icon('plus')}Create page</button></div>`}</div></section>`;
  }

  function previewContent() {
    const preview = url(state.previewUrl, { separateOrigin: true });
    if (preview) return `<iframe title="${escape(state.page?.title || 'Website')} draft preview" src="${escape(preview)}" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>`;
    return `<div class="empty-state">${icon(state.previewError ? 'info' : 'eye')}<h2>${state.previewError ? 'Preview unavailable' : 'Preparing your preview'}</h2><p>${escape(state.previewError || 'Your draft opens in an isolated website preview.')}</p>${state.previewError ? '<button class="btn small" data-action="preview" type="button">Try again</button>' : ''}</div>`;
  }

  function sourcePane() {
    const tab = state.sourceTab;
    const tabs = ['html', 'css', 'js', 'settings'];
    const language = { html: 'HTML + Tailwind', css: 'Custom CSS', js: 'Browser JavaScript', settings: 'Page settings' };
    return `<section class="source-pane" id="source-panel" aria-label="Page source"><div class="source-tabs" role="tablist" aria-label="Source language">${tabs.map((name) => `<button type="button" role="tab" aria-selected="${tab === name}" aria-controls="source-body" id="tab-${name}" tabindex="${tab === name ? '0' : '-1'}" data-action="source-tab" data-tab="${name}">${name === 'settings' ? 'Settings' : name.toUpperCase()}</button>`).join('')}</div><div class="source-body" id="source-body" role="tabpanel" aria-labelledby="tab-${tab}">${tab === 'settings' ? pageSettings() : `<textarea class="source-textarea" data-page-field="${tab}" aria-label="${language[tab]} source" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off">${escape(state.page[tab] || '')}</textarea>`}</div><footer class="source-footer"><span>${language[tab]}</span><span id="source-count">${tab === 'settings' ? 'SEO and URL' : `${String(state.page[tab] || '').split('\n').length} lines`}</span></footer></section>`;
  }

  function pageSettings() {
    const p = state.page, seo = p.seo || {};
    const field = (key, label, placeholder = '') => `<label>${label}<input data-seo-field="${key}" value="${escape(seo[key] || '')}" placeholder="${escape(placeholder)}"></label>`;
    const automatic = `${state.project.domain ? `https://${state.project.domain}/` : state.urls.site}${p.slug || ''}`;
    return `<div class="settings-form"><label>Page title<input data-page-field="title" value="${escape(p.title)}" maxlength="200"></label><label>URL path<input data-page-field="slug" value="${escape(p.slug || '')}" spellcheck="false" placeholder="Leave empty for homepage"><small>Nested paths work too: blog/my-article.</small></label><label>Search description<textarea data-page-field="description" aria-label="Search description" rows="4" maxlength="500">${escape(p.description || '')}</textarea></label><fieldset><legend>Search and sharing</legend>${field('title', 'SEO title override', p.title)}${field('canonical', 'Canonical URL override', automatic)}<p class="hint">Leave overrides empty to use the page title and production domain automatically.</p>${field('image', 'Social image URL', '/media/project/image.png')}${field('imageAlt', 'Social image description')}<label class="checkbox-label"><input type="checkbox" data-seo-field="noindex" ${seo.noindex ? 'checked' : ''}>Keep this page out of search results</label><p class="hint">Page settings are drafts until published. Preview URLs always stay noindex.</p></fieldset><fieldset><legend>Blog article</legend><label>Page type<select data-seo-field="type" aria-label="Page type"><option value="website" ${seo.type !== 'article' ? 'selected' : ''}>Website page</option><option value="article" ${seo.type === 'article' ? 'selected' : ''}>Blog article</option></select></label>${field('headline', 'Article headline', p.title)}${field('author', 'Author organization', state.project.name)}${field('publishedTime', 'Publication time', '2026-10-22T12:00:00.000Z')}${field('modifiedTime', 'Modified time override', 'Automatic from the published revision')}<p class="hint">Use ISO dates with a timezone. Published articles appear in the blog list and RSS feed automatically.</p></fieldset><fieldset><legend>Additional structured data</legend><label>Structured data (JSON-LD)<textarea data-seo-json aria-label="Structured data (JSON-LD)" rows="8" spellcheck="false">${escape(p._seoJson ?? (seo.structuredData ? JSON.stringify(seo.structuredData, null, 2) : ''))}</textarea></label><p class="hint">Optional JSON object or array. Organization, WebSite, WebPage, breadcrumbs, and BlogPosting are already generated. Add only information supported by the page.</p></fieldset></div>`;
  }

  function projectSeoForm() {
    const seo = state.project.seo || {};
    const field = (key, label, placeholder = '') => `<label>${label}<input name="${key}" value="${escape(seo[key] || '')}" placeholder="${escape(placeholder)}"></label>`;
    return `<section class="surface seo-surface"><div class="surface-header"><div><span class="eyebrow">Search & sharing</span><h2>SEO and branding</h2><p>Shared defaults for this website.</p></div></div><form class="seo-form" data-form="project-seo">${field('siteName', 'Site name', state.project.name)}<label>Site description<textarea name="description" aria-label="Site description" rows="3">${escape(seo.description || '')}</textarea></label>${field('language', 'Website language', 'en')}${field('image', 'Default social image URL')}${field('imageAlt', 'Default social image description')}${field('logo', 'Organization logo URL')}${field('favicon', 'Favicon URL')}${field('appleTouchIcon', 'Apple touch icon URL')}<label class="checkbox-label"><input name="noindex" type="checkbox" ${seo.noindex ? 'checked' : ''}>Keep the whole website out of search results</label><p class="hint">Shared defaults apply immediately. Production indexing requires the configured domain; project-path and draft previews remain noindex.</p><div class="row"><button class="btn" type="submit">Save SEO settings</button></div></form></section>`;
  }

  function mediaType(asset) {
    const mime = asset.mime || asset.type || '';
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    return 'code';
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(Number(bytes))) return '';
    if (Number(bytes) < 1024) return `${bytes} B`;
    if (Number(bytes) < 1024 * 1024) return `${(Number(bytes) / 1024).toFixed(1)} KB`;
    return `${(Number(bytes) / 1024 / 1024).toFixed(1)} MB`;
  }

  function mediaView() {
    return `<div class="page-heading"><div><h1>Media library</h1><p>Images, audio, and video for ${escape(state.project.name)}. Hosted on your server.</p></div><span class="pill">${state.assets.length} ${state.assets.length === 1 ? 'file' : 'files'}</span></div><div class="upload-zone" id="upload-zone"><span class="upload-icon">${icon('upload')}</span><div><h3>Drop your files here</h3><p>Upload images, audio, or video. Copy their URLs into any page.</p></div><button class="btn" data-action="choose-files" type="button">${icon('plus')}Choose files</button><input type="file" id="asset-file" accept="image/*,audio/*,video/*" multiple hidden></div>
      ${state.assets.length ? `<section class="asset-grid" aria-label="Media files">${state.assets.map((asset) => {
        const safe = url(asset.url);
        const type = mediaType(asset);
        let preview = icon(type);
        if (safe && type === 'image') preview = `<img src="${escape(safe)}" alt="${escape(asset.name || 'Uploaded image')}" loading="lazy" referrerpolicy="no-referrer">`;
        if (safe && type === 'video') preview = `<video src="${escape(safe)}" controls preload="metadata" aria-label="${escape(asset.name || 'Uploaded video')}"></video>`;
        if (safe && type === 'audio') preview = `<audio src="${escape(safe)}" controls preload="metadata" aria-label="${escape(asset.name || 'Uploaded audio')}"></audio>`;
        return `<article class="asset-item"><div class="asset-preview">${preview}</div><div class="asset-details"><p class="asset-name" title="${escape(asset.name)}">${escape(asset.name || 'Untitled file')}</p><p class="asset-meta"><span>${escape(type === 'code' ? 'File' : type[0].toUpperCase() + type.slice(1))}</span><span>${escape(formatBytes(asset.size))}</span></p><div class="row spread"><button class="btn small" type="button" data-action="copy" data-copy="${escape(safe)}">${icon('copy')}Copy URL</button>${external(safe, 'Open')}</div></div></article>`;
      }).join('')}</section>` : `<section class="surface empty-state">${icon('image')}<h2>Give your website something to show.</h2><p>Your uploaded files will appear here. Start with a logo, product screenshot, or video.</p><button class="btn" data-action="choose-files" type="button">${icon('upload')}Upload your first file</button></section>`}`;
  }

  function libraryView() {
    const animation = state.libraryTab === 'animations';
    const entries = state.library?.[state.libraryTab] || [];
    return `<div class="page-heading"><div><span class="eyebrow">Design library</span><h1>Components & motion</h1><p>Add a starting point to ${state.page ? `“${escape(state.page.title)}”` : 'your page'}, then make every detail yours.</p></div><button class="btn" type="button" data-action="navigate" data-view="pages">${icon('code')}Back to page</button></div><div class="section-tabs" aria-label="Library categories"><button type="button" data-action="library-tab" data-tab="components" class="${animation ? '' : 'active'}">Components</button><button type="button" data-action="library-tab" data-tab="animations" class="${animation ? 'active' : ''}">LumaFX animations</button></div>
      ${animation ? `<div class="library-callout"><span class="library-icon">${icon('sparkle')}</span><div><h3>Motion is part of the language.</h3><p>LumaFX loads with every page. Add an effect, then customize its attributes in your HTML.</p></div><span class="pill violet" style="margin-left:auto">Native</span></div>` : ''}
      ${entries.length ? `<section class="library-grid" aria-label="${animation ? 'Animations' : 'Components'}">${entries.map((entry) => `<article class="library-item${animation ? ' animation' : ''}"><span class="library-icon">${icon(animation ? 'sparkle' : 'layers')}</span><h3>${escape(entry.name)}</h3><p>${escape(entry.description || '')}</p>${entry.category ? `<span class="pill violet" style="align-self:start">${escape(entry.category)}</span>` : ''}<button class="btn small${animation ? ' violet' : ''}" type="button" data-action="apply-snippet" data-id="${escape(entry.id)}" ${!state.page ? 'disabled' : ''}>${icon('plus')}Add to page</button></article>`).join('')}</section>` : `<section class="surface empty-state">${icon('layers')}<h2>The library is empty.</h2><p>Check the server library configuration, or write your own HTML, CSS, and JavaScript in the page editor.</p></section>`}`;
  }

  function connectionsView() {
    const urls = state.urls || {};
    const token = state.projectTokens.get(state.project.id);
    return `<div class="page-heading"><div><span class="eyebrow">Website settings</span><h1>Connections</h1><p>Every address, connection, and search setting for ${escape(state.project.name)}.</p></div><button class="btn" type="button" data-action="project-export-zip">${icon('download')}Export ZIP</button></div>
      <section class="surface website-addresses"><div class="surface-header"><div><h2>Website links</h2><p>Open a resource or copy its full URL.</p></div><span class="pill">${icon('globe')}${escape(state.project.slug)}</span></div><div class="environment-grid">${environmentLinks()}${environmentLinks(true)}</div><p class="hint links-footnote">Preview URLs stay out of search results. Production links use your configured domain; DNS, reverse proxy, and HTTPS must point to this installation.</p></section>
      <div class="view-columns connections-columns"><div><section class="surface"><div class="surface-header"><div><span class="eyebrow">Agent access</span><h2>MCP connection</h2><p>Create, edit, and publish with your own tools.</p></div><span class="panel-icon">${icon('connect')}</span></div><div class="stack"><div class="field-group"><span>Server URL</span>${copyField(urls.mcp || '')}</div><div class="field-group"><span>Project access token</span>${token ? `${copyField(token, 'Copy', true)}<p class="hint">Saved privately on your server. Keep this token with your MCP client credentials.</p>` : '<p class="hint">Tokens are only shown when created or rotated. Retrieve the saved token with the server credentials command, or generate a new one.</p>'}</div><div><button class="btn small" type="button" data-action="rotate-token">${icon('refresh')}Generate new token</button></div><div class="info-note">${icon('lock')}<span>Connect with a <strong>Bearer token</strong> using Streamable HTTP. Access is limited to this website.</span></div></div></section>
      <section class="surface"><div class="surface-header"><div><h2>Studio & draft preview</h2><p>Private tools for managing this website.</p></div></div>${addressRow(urls.admin, 'Website studio', 'lock')}<div class="draft-link-panel"><div><strong>Private draft link</strong><p class="hint">${escape(state.page?.title || 'No page selected')} · A signed link to the saved draft. Anyone with the link can view it until it expires.</p></div>${state.page ? `<button class="btn small" type="button" data-action="draft-link">${icon('eye')}${state.dirty ? 'Save & get draft link' : 'Get draft link'}</button>` : ''}<div class="row draft-external-links">${draftLinks()}</div>${state.previewError ? `<p class="form-error">${escape(state.previewError)}</p>` : ''}</div></section></div>
      <div><section class="surface"><div class="surface-header"><div><h2>Website settings</h2><p>Your name and production domain.</p></div>${icon('globe')}</div><form class="stack" data-form="project-settings"><label>Website name<input name="name" required maxlength="100" value="${escape(state.project.name)}"></label><label>Production domain<input name="domain" value="${escape(state.project.domain || '')}" placeholder="example.com" spellcheck="false"><small>Point DNS to your server and configure HTTPS with the CLI proxy command.</small></label><div><button class="btn" type="submit">Save settings</button></div></form></section>
      <section class="surface"><div class="surface-header"><div><h2>Installation ports</h2><p>One studio, separate website runtime.</p></div></div><div class="stack"><div class="check-row"><span>Admin, API & MCP</span><code class="port-number">${escape(state.port)}</code></div><div class="check-row"><span>Websites & media</span><code class="port-number">${escape(state.sitePort)}</code></div><button class="btn small" type="button" data-action="navigate" data-view="runtime">${icon('pulse')}Health, logs & commands${icon('arrow')}</button></div></section></div></div>${projectSeoForm()}`;
  }

  function runtimeValue(value, fallback = 'Unavailable') {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function uptime(seconds) {
    if (!Number.isFinite(Number(seconds))) return 'Unavailable';
    const value = Math.floor(Number(seconds));
    if (value < 60) return `${value}s`;
    if (value < 3600) return `${Math.floor(value / 60)}m ${value % 60}s`;
    return `${Math.floor(value / 3600)}h ${Math.floor(value % 3600 / 60)}m`;
  }

  function shellQuote(value) {
    return `'${String(value).replace(/'/g, "'\\''")}'`;
  }

  function runtimeView() {
    const diagnostics = state.diagnostics;
    if (!diagnostics) return `<div class="page-heading"><div><h1>Runtime</h1><p>Ports, health, logs, and commands for your installation.</p></div><button class="btn" type="button" data-action="refresh-runtime">${icon('refresh')}Refresh</button></div><section class="surface empty-state">${icon('pulse')}<h2>Runtime details are not loaded.</h2><p>Refresh to check the running server and its storage.</p></section>`;
    const health = state.health || {};
    const healthy = health.status === 'ok';
    const dataDir = diagnostics.dataDir || diagnostics.paths?.dataDir || diagnostics.paths?.data || '';
    const cli = diagnostics.cliPath ? `node ${shellQuote(diagnostics.cliPath)}` : 'node bin/lumasite.mjs';
    const suffix = dataDir ? ` --data-dir ${shellQuote(dataDir)}` : '';
    let checks = diagnostics.checks;
    if (checks && !Array.isArray(checks)) checks = Object.entries(checks).map(([name, value]) => ({ name, ...(typeof value === 'object' ? value : { ok: value === true || value === 'ok', detail: value }) }));
    if (!Array.isArray(checks)) checks = [];
    const checkNames = { storage: 'Website storage', tailwind: 'Tailwind compiler', lumafx: 'LumaFX runtime', isolatedPublicOrigin: 'Separate website origin' };
    const logPath = diagnostics.log || diagnostics.logPath || diagnostics.paths?.log || diagnostics.paths?.logs;
    const commands = [ ['Status', 'status'], ['Health', 'health'], ['Diagnose', 'doctor'], ['Logs', 'logs --follow'], ['Start', 'start'], ['Restart', 'restart'], ['Stop', 'stop'], ['Credentials', 'credentials'] ];
    const domainFlag = ` --domain ${shellQuote(state.project?.domain || 'website.example.com')} --admin-domain ${shellQuote(['localhost', '127.0.0.1'].includes(window.location.hostname) ? 'studio.example.com' : window.location.hostname)}`;
    return `<div class="page-heading"><div><span class="eyebrow">Installation</span><h1>Runtime</h1><p>Live information from this LumaSite installation.</p></div><button class="btn" type="button" data-action="refresh-runtime">${icon('refresh')}Refresh</button></div><dl class="runtime-grid"><div class="runtime-stat"><dt>Server health</dt><dd class="small-value" style="color:${healthy ? 'var(--green)' : 'var(--red)'}">${healthy ? 'Running normally' : 'Check required'}</dd></div><div class="runtime-stat"><dt>Admin / website port</dt><dd>${escape(health.port || diagnostics.port || state.port)} <span class="muted" style="font-weight:400">/</span> ${escape(health.sitePort || diagnostics.sitePort || state.sitePort)}</dd></div><div class="runtime-stat"><dt>Process ID</dt><dd>${escape(health.pid || diagnostics.pid || '—')}</dd></div><div class="runtime-stat"><dt>Uptime</dt><dd>${escape(uptime(health.uptime ?? diagnostics.uptime))}</dd></div></dl><div class="view-columns"><div><section class="surface"><div class="surface-header"><div><h2>Server commands</h2><p>Run these from your LumaSite installation directory.</p></div>${icon('code')}</div><div class="stack">${commands.map(([label, command]) => `<div class="command-row"><span>${label}</span>${copyField(`${cli} ${command}${suffix}`)}</div>`).join('')}</div><p class="hint" style="margin-top:17px">Restart and stop act on this installation’s verified process. Stopping the server also closes this studio until you start it again.</p></section><section class="surface"><div class="surface-header"><div><h2>Proxy configuration</h2><p>Generate a configuration for your existing web server.</p></div></div><div class="stack">${copyField(`${cli} proxy --format apache${domainFlag}${suffix}`)}${copyField(`${cli} proxy --format caddy${domainFlag}${suffix}`)}<p class="hint">Review the generated configuration before adding it to Apache or Caddy. The command prints configuration without changing your server.</p></div></section></div><div><section class="surface"><div class="surface-header"><h2>Health checks</h2><span class="pill ${state.readiness?.status === 'ready' ? 'success' : 'warning'}">${state.readiness?.status === 'ready' ? 'Ready' : 'Check readiness'}</span></div><div class="check-list"><div class="check-row"><span class="check-label">${icon(healthy ? 'check' : 'info')}HTTP health endpoint</span>${external(`${window.location.origin}/health`, '/health')}</div><div class="check-row"><span class="check-label">${icon(state.readiness?.status === 'ready' ? 'check' : 'info')}Readiness endpoint</span>${external(`${window.location.origin}/ready`, '/ready')}</div>${checks.map((check) => { const ok = check.ok ?? check.status === 'ok'; return `<div class="check-row"><span class="check-label">${icon(ok ? 'check' : 'info')}<span>${escape(checkNames[check.name] || check.label || check.name || 'Check')}${check.detail && typeof check.detail !== 'boolean' ? `<br><small class="muted">${escape(runtimeValue(check.detail))}</small>` : ''}</span></span><span class="pill ${ok ? 'success' : 'warning'}">${ok ? 'Passed' : 'Review'}</span></div>`; }).join('')}</div></section><section class="surface"><div class="surface-header"><h2>Installation details</h2></div><div class="stack">${dataDir ? `<div class="field-group"><span>Data directory</span>${copyField(dataDir)}</div>` : ''}${logPath ? `<div class="field-group"><span>Server log</span>${copyField(runtimeValue(logPath))}</div>` : ''}<div class="check-row"><span>Version</span><code>${escape(health.version || state.version || '—')}</code></div><div class="check-row"><span>Websites</span><code>${escape(Array.isArray(diagnostics.projects) ? diagnostics.projects.length : diagnostics.projects ?? state.projects.length)}</code></div></div><details><summary>Full runtime response</summary><pre class="raw-json">${escape(JSON.stringify({ health, readiness: state.readiness, diagnostics }, null, 2))}</pre></details></section></div></div>`;
  }

  function formatDate(value) {
    try { const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value || 'Unknown date') : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return String(value || 'Unknown date'); }
  }

  function importModal() {
    return `<dialog class="dialog wide import-dialog" aria-labelledby="dialog-title"><div class="dialog-header"><h2 id="dialog-title">Import a website</h2><button class="btn icon-only" data-action="close-modal" type="button" aria-label="Close">${icon('close')}</button></div><p>Move a LumaSite website to this installation. The ZIP becomes a new website with its own connection.</p><form data-form="import-zip"><div id="form-error" class="form-error" role="alert" hidden></div><label class="import-file-label">Website ZIP<input id="import-zip-file" name="archive" type="file" accept=".zip,application/zip,application/x-zip-compressed" required><small id="import-file-detail">Choose a LumaSite export, up to 100 MB.</small></label><div class="grid-fields"><label>Website name<input name="name" maxlength="100" placeholder="Use the name in the ZIP" autocomplete="off"><small>Leave empty to keep the exported name.</small></label><label>Project URL slug<input name="slug" maxlength="100" placeholder="Use the slug in the ZIP" autocapitalize="off" spellcheck="false" autocomplete="off"><small>Choose an unused slug, such as sendmailos-copy.</small></label></div><label>Website links<select name="linkMode"><option value="project">Use this server’s project URL</option><option value="domain">Use a production domain</option></select><small>Local project URLs work immediately. Production domains need DNS and HTTPS on this server.</small></label><label><span>Destination domain <small class="optional-label" id="import-domain-optional">(optional)</small></span><input name="domain" placeholder="example.com" autocapitalize="off" spellcheck="false" autocomplete="off"><small>The original website’s domain is never connected automatically.</small></label><section class="import-review" aria-labelledby="import-summary-title"><h3 id="import-summary-title">Import summary</h3><dl><div><dt>Archive</dt><dd id="import-summary-file">No ZIP selected</dd></div><div><dt>New website</dt><dd id="import-summary-name">Name from the ZIP</dd></div><div><dt>Website links</dt><dd id="import-summary-links">This server’s project URL</dd></div><div><dt>Domain</dt><dd id="import-summary-domain">No domain connected</dd></div></dl><p>Pages, saved drafts, published versions, and media are restored. Your existing websites stay unchanged. A new MCP connection is created.</p></section><div class="dialog-actions"><button class="btn" type="button" data-action="close-modal">Cancel</button><button id="import-submit" class="btn primary" type="submit" disabled>${icon('upload')}Import website</button></div></form></dialog>`;
  }

  function updateImportSummary() {
    const form = document.querySelector('[data-form="import-zip"]');
    if (!form) return;
    const name = form.elements.name.value.trim(), slug = form.elements.slug.value.trim();
    const domain = form.elements.domain.value.trim(), domainLinks = form.elements.linkMode.value === 'domain';
    form.elements.domain.required = domainLinks;
    document.getElementById('import-domain-optional').hidden = domainLinks;
    document.getElementById('import-summary-file').textContent = state.importFile ? `${state.importFile.name} · ${formatBytes(state.importFile.size)}` : 'No ZIP selected';
    document.getElementById('import-summary-name').textContent = name || 'Name from the ZIP';
    document.getElementById('import-summary-links').textContent = domainLinks ? (domain ? `https://${domain}` : 'Enter a destination domain') : `/sites/${slug || '[slug from ZIP]'}/ on this server`;
    document.getElementById('import-summary-domain').textContent = domain || 'No domain connected';
    document.getElementById('import-submit').disabled = !state.importFile;
  }

  function modalView() {
    if (!state.modal) return '';
    if (state.modal === 'import') return importModal();
    if (state.modal === 'project') return `<dialog class="dialog" aria-labelledby="dialog-title"><div class="dialog-header"><h2 id="dialog-title">Create a website</h2><button class="btn icon-only" data-action="close-modal" type="button" aria-label="Close">${icon('close')}</button></div><p>A name and a domain. Your studio handles the rest.</p>${projectForm()}</dialog>`;
    if (state.modal === 'page') return `<dialog class="dialog" aria-labelledby="dialog-title"><div class="dialog-header"><h2 id="dialog-title">Create a page</h2><button class="btn icon-only" data-action="close-modal" type="button" aria-label="Close">${icon('close')}</button></div><p>Add a new page to ${escape(state.project?.name)}.</p><form data-form="page"><div id="form-error" class="form-error" hidden></div><label>Page title<input name="title" required maxlength="200" placeholder="About us" autofocus></label><label>URL path<input name="slug" spellcheck="false" placeholder="about"><small>Leave empty for the homepage. Existing paths must be unique.</small></label><div class="dialog-actions"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Create page</button></div></form></dialog>`;
    if (state.modal === 'revisions') return `<dialog class="dialog wide" aria-labelledby="dialog-title"><div class="dialog-header"><h2 id="dialog-title">Published revisions</h2><button class="btn icon-only" data-action="close-modal" type="button" aria-label="Close">${icon('close')}</button></div><p>Restore a previous version of ${escape(state.page?.title)} to your draft. Publish it when you’re ready to make it live.</p><div class="revision-list">${state.revisions.length ? state.revisions.map((revision, index) => `<div class="revision-item"><div><p>${escape(revision.title || `Published revision ${state.revisions.length - index}`)}${revision.id === state.page?.publishedRevisionId ? '<span class="pill success">Live</span>' : ''}</p><small>${escape(formatDate(revision.createdAt))} · ${escape(revision.id?.slice(0, 8) || '')}</small></div><button class="btn small" type="button" data-action="restore" data-id="${escape(revision.id)}">Restore draft</button></div>`).join('') : '<div class="empty-state">' + icon('history') + '<h2>No published revisions yet.</h2><p>Each publish saves a revision that you can return to.</p></div>'}</div></dialog>`;
    return '';
  }

  async function loadProjects() {
    const response = await api('/api/projects');
    state.projects = response.projects || [];
  }

  function projectPath(suffix = '') {
    return `/api/projects/${encodeURIComponent(state.project.id)}${suffix}`;
  }

  function pagePath(suffix = '') {
    return projectPath(`/pages/${encodeURIComponent(state.page.id)}${suffix}`);
  }

  function updateProjectCollection() {
    const index = state.projects.findIndex((project) => project.id === state.project?.id);
    if (index >= 0) state.projects[index] = { ...state.project, urls: state.urls };
  }

  function updatePageCollection() {
    const index = state.pages.findIndex((page) => page.id === state.page?.id);
    if (index >= 0) state.pages[index] = { ...state.page };
  }

  async function selectProject(id, { push = true, view = 'overview', checkDirty = true } = {}) {
    if (checkDirty && !discardDraft()) return;
    const [details, pages] = await Promise.all([
      api(`/api/projects/${encodeURIComponent(id)}`),
      api(`/api/projects/${encodeURIComponent(id)}/pages`),
    ]);
    state.menuOpen = false;
    state.project = details.project;
    state.urls = details.urls;
    state.pages = pages.pages || [];
    state.page = state.pages[0] || null;
    state.previewUrl = '';
    state.previewError = '';
    state.sourceTab = 'html';
    state.modal = null;
    state.view = view;
    markClean();
    if (push) history.pushState({}, '', `/admin/projects/${encodeURIComponent(id)}`);
    updateProjectCollection();
    if (view === 'media') await loadAssets();
    if (view === 'library') await loadLibrary();
    render();
    if (state.page && view === 'pages') await refreshPreview();
  }

  async function refreshPreview() {
    if (!state.page || !state.project) return;
    state.previewError = '';
    try {
      const response = await api(projectPath('/preview'), { method: 'POST', body: { pageId: state.page.id } });
      const safe = url(response.url, { separateOrigin: true });
      if (!safe) throw new Error('The preview must use the separate website port. Check the site URL and site-port configuration.');
      state.previewUrl = safe;
    } catch (error) {
      state.previewError = error.message;
      state.previewUrl = '';
    }
    document.querySelectorAll('.draft-external-links').forEach((element) => { element.innerHTML = draftLinks(); });
    const wrap = document.getElementById('preview-wrap');
    if (wrap) { wrap.innerHTML = previewContent(); applyBusyUI(); requestAnimationFrame(fitPreview); }
  }

  async function persistDraft({ notify = true } = {}) {
    if (!state.page) return;
    const result = await api(pagePath(), { method: 'PUT', body: { ...pagePayload(state.page, true), revision: state.page.revision } });
    state.page = result.page;
    updatePageCollection();
    markClean();
    if (notify) toast('Draft saved. Your live website is unchanged.');
  }

  async function selectPage(id) {
    if ((id === state.page?.id && state.view === 'pages') || !discardDraft()) return;
    const response = await api(projectPath(`/pages/${encodeURIComponent(id)}`));
    state.page = response.page;
    state.view = 'pages';
    state.sourceTab = 'html';
    state.previewUrl = '';
    state.previewError = '';
    markClean();
    render();
    await refreshPreview();
  }

  async function loadAssets() {
    const response = await api(projectPath('/assets'));
    state.assets = response.assets || [];
  }

  async function loadLibrary() {
    if (!state.library) state.library = await api('/api/library');
  }

  async function loadRuntime() {
    const results = await Promise.allSettled([api('/api/diagnostics'), api('/health'), api('/ready')]);
    if (results[0].status === 'rejected') throw results[0].reason;
    state.diagnostics = results[0].value;
    state.health = results[1].status === 'fulfilled' ? results[1].value : { status: 'error', error: results[1].reason.message };
    state.readiness = results[2].status === 'fulfilled' ? results[2].value : { status: 'error', error: results[2].reason.message };
    state.port = state.health.port || state.diagnostics.port || state.port;
    state.sitePort = state.health.sitePort || state.diagnostics.sitePort || state.sitePort;
  }

  async function navigate(view) {
    if (view === 'projects') {
      if (!discardDraft()) return;
      state.project = null;
      state.page = null;
      markClean();
      history.pushState({}, '', '/admin');
    }
    if (view === 'media') await loadAssets();
    if (view === 'library') await loadLibrary();
    if (view === 'runtime') await loadRuntime();
    state.menuOpen = false;
    state.view = view;
    render();
    if (view === 'pages' && state.page && !state.previewUrl) await refreshPreview();
  }

  async function uploadFiles(files) {
    if (!files.length) return;
    if (Array.from(files).some((file) => !/^(image|audio|video)\//.test(file.type))) throw new Error('Choose image, audio, or video files. Files without a recognized media type cannot be uploaded.');
    let uploaded = 0;
    try {
      for (const file of files) {
        await api(projectPath('/assets'), { method: 'POST', headers: { 'Content-Type': file.type, 'X-Filename': encodeURIComponent(file.name) }, body: file });
        uploaded += 1;
      }
    } catch (error) {
      if (uploaded) { await loadAssets(); render(); }
      throw new Error(`${uploaded ? `${uploaded} file${uploaded === 1 ? '' : 's'} uploaded. ` : ''}${error.message}`);
    }
    await loadAssets();
    render();
    toast(`${uploaded} ${uploaded === 1 ? 'file uploaded' : 'files uploaded'}. Copy a URL to use it in your page.`);
  }

  async function exportWebsite() {
    if (state.dirty) await persistDraft({ notify: false });
    const response = await api(projectPath('/export'), { responseType: 'blob' });
    let filename = `${state.project.slug || 'website'}.zip`;
    const encoded = response.disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const plain = response.disposition.match(/filename="([^"]+)"/i);
    try { if (encoded) filename = decodeURIComponent(encoded[1]); else if (plain) filename = plain[1]; } catch { /* Keep the safe project filename. */ }
    const objectUrl = URL.createObjectURL(response.blob), anchor = document.createElement('a');
    anchor.href = objectUrl; anchor.download = filename;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    toast('Website ZIP downloaded. It is ready to import into another LumaSite installation.');
  }

  async function clipboard(value) {
    if (!value) throw new Error('There is nothing to copy yet.');
    try { await navigator.clipboard.writeText(value); }
    catch {
      const temporary = document.createElement('textarea');
      temporary.value = value;
      temporary.style.position = 'fixed';
      temporary.style.opacity = '0';
      document.body.appendChild(temporary);
      temporary.select();
      const copied = document.execCommand('copy');
      temporary.remove();
      if (!copied) throw new Error('Clipboard access is blocked. Select the value and copy it manually.');
    }
    toast('Copied to clipboard.');
  }

  const actions = {
    'toggle-menu': () => {
      state.menuOpen = !state.menuOpen;
      syncNavigation();
      if (state.menuOpen) document.querySelector('#studio-navigation [aria-label="Close navigation"]')?.focus();
      else document.getElementById('menu-trigger')?.focus();
    },
    home: () => navigate('projects'),
    navigate: (element) => navigate(element.dataset.view),
    'new-project': () => { state.modal = 'project'; render(); },
    'import-zip': () => { state.importFile = null; state.modal = 'import'; render(); updateImportSummary(); },
    'project-export-zip': exportWebsite,
    'new-page': () => { state.modal = 'page'; render(); },
    'close-modal': () => { state.modal = null; state.importFile = null; render(); },
    'select-project': (element) => selectProject(element.dataset.id),
    'select-page': (element) => selectPage(element.dataset.id),
    copy: (element) => clipboard(element.dataset.copy),
    logout: async () => {
      if (!discardDraft()) return;
      await api('/api/logout', { method: 'POST' });
      state.authenticated = false;
      state.projectTokens.clear();
      state.project = null;
      state.page = null;
      markClean();
      render();
    },
    save: async () => { await persistDraft(); render(); await refreshPreview(); },
    publish: async () => {
      if (state.dirty) await persistDraft({ notify: false });
      const response = await api(pagePath('/publish'), { method: 'POST' });
      state.page = response.page;
      updatePageCollection();
      markClean();
      render();
      await refreshPreview();
      toast('Page published. Your new revision is live.');
    },
    preview: async () => {
      if (state.dirty) { await persistDraft({ notify: false }); render(); }
      await refreshPreview();
      if (state.previewError) throw new Error(state.previewError);
      toast('Draft preview refreshed.');
    },
    'draft-link': async () => {
      if (state.dirty) await persistDraft({ notify: false });
      await refreshPreview();
      render();
      if (state.previewError) throw new Error(state.previewError);
      toast('Private draft link ready. It opens your saved draft.');
    },
    device: (element) => {
      state.device = element.dataset.device;
      const wrap = document.getElementById('preview-wrap');
      if (wrap) wrap.dataset.device = state.device;
      fitPreview();
      document.querySelectorAll('[data-action="device"]').forEach((button) => {
        const active = button.dataset.device === state.device;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    },
    'source-tab': (element) => {
      state.sourceTab = element.dataset.tab;
      const old = document.getElementById('source-panel');
      if (old) old.outerHTML = sourcePane();
      document.getElementById(`tab-${state.sourceTab}`)?.focus();
    },
    'library-tab': (element) => { state.libraryTab = element.dataset.tab; render(); },
    'apply-snippet': (element) => {
      const snippet = state.library?.[state.libraryTab]?.find((entry) => entry.id === element.dataset.id);
      if (!snippet || !state.page) return;
      for (const field of ['html', 'css', 'js']) {
        if (snippet[field]) state.page[field] = `${state.page[field] || ''}\n\n${snippet[field]}`.trim();
      }
      state.dirty = true;
      state.view = 'pages';
      state.sourceTab = 'html';
      render();
      toast(`${snippet.name} added to your draft. Save to preview it.`);
    },
    'choose-files': () => document.getElementById('asset-file')?.click(),
    revisions: async () => {
      const response = await api(pagePath('/revisions'));
      state.revisions = response.revisions || [];
      state.modal = 'revisions';
      render();
    },
    restore: async (element) => {
      if (!discardDraft()) return;
      const response = await api(pagePath('/restore'), { method: 'POST', body: { revisionId: element.dataset.id } });
      state.page = response.page;
      updatePageCollection();
      state.modal = null;
      markClean();
      render();
      await refreshPreview();
      toast('Revision restored to your draft. Publish to make it live.');
    },
    'rotate-token': async () => {
      if (!window.confirm('Generate a new project token? The current token will stop working, so existing MCP clients will need the new one.')) return;
      const response = await api(projectPath('/token'), { method: 'POST' });
      state.projectTokens.set(state.project.id, response.token);
      render();
      toast('New token generated. Copy it into your MCP client.');
    },
    'refresh-runtime': async () => { await loadRuntime(); render(); toast('Runtime details refreshed.'); },
  };

  // These actions only change local UI state; running them outside the network
  // lock preserves keyboard focus and keeps file picker activation synchronous.
  const localActions = new Set(['toggle-menu', 'new-project', 'import-zip', 'new-page', 'close-modal', 'source-tab', 'device', 'library-tab', 'apply-snippet', 'choose-files']);

  app.addEventListener('click', (event) => {
    const element = event.target.closest('[data-action]');
    if (!element) return;
    const action = actions[element.dataset.action];
    if (!action) return;
    event.preventDefault();
    if (state.busy) return;
    if (localActions.has(element.dataset.action)) {
      try { action(element); } catch (error) { toast(error.message, true); }
      return;
    }
    run(() => action(element));
  });

  app.addEventListener('submit', (event) => {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    run(async () => {
      if (form.dataset.form === 'setup' || form.dataset.form === 'login') {
        const settingUp = form.dataset.form === 'setup';
        await api(settingUp ? '/api/setup' : '/api/login', { method: 'POST', body: values });
        state.authenticated = true;
        state.configured = true;
        state.formError = '';
        await loadProjects();
        await routeFromLocation();
        return;
      }
      if (form.dataset.form === 'project') {
        if (!discardDraft()) return;
        const response = await api('/api/projects', { method: 'POST', body: values });
        state.projectTokens.set(response.project.id, response.token);
        await loadProjects();
        await selectProject(response.project.id, { view: 'connections', checkDirty: false });
        toast('Website created. Your addresses and MCP token are ready.');
        return;
      }
      if (form.dataset.form === 'import-zip') {
        if (state.dirty) await persistDraft({ notify: false });
        if (!state.importFile) throw new Error('Choose a LumaSite ZIP to import.');
        const query = new URLSearchParams();
        for (const key of ['name', 'slug', 'domain', 'linkMode']) {
          const value = String(values[key] || '').trim();
          if (value || key === 'domain') query.set(key, value);
        }
        const response = await api(`/api/projects/import?${query}`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: state.importFile });
        state.projectTokens.set(response.project.id, response.token);
        state.importFile = null;
        await loadProjects();
        await selectProject(response.project.id, { view: 'connections', checkDirty: false });
        toast(`Website imported: ${response.pages} page${response.pages === 1 ? '' : 's'} and ${response.assets} media file${response.assets === 1 ? '' : 's'}. Your new MCP connection is ready.`);
        return;
      }
      if (form.dataset.form === 'page') {
        if (!discardDraft()) return;
        const response = await api(projectPath('/pages'), { method: 'POST', body: values });
        state.pages.push(response.page);
        state.page = response.page;
        state.view = 'pages';
        state.modal = null;
        state.previewUrl = '';
        state.previewError = '';
        state.sourceTab = 'html';
        markClean();
        render();
        await refreshPreview();
        toast('Page created. Start writing or add a section from the library.');
        return;
      }
      if (form.dataset.form === 'project-seo') {
        values.noindex = form.elements.noindex.checked;
        if (!values.language.trim()) values.language = 'en';
        const response = await api(projectPath(), { method: 'PATCH', body: { seo: values } });
        state.project = response.project;
        state.urls = response.urls;
        updateProjectCollection();
        render();
        toast('SEO defaults saved.');
      }
      if (form.dataset.form === 'project-settings') {
        const response = await api(projectPath(), { method: 'PATCH', body: values });
        state.project = response.project;
        state.urls = response.urls;
        updateProjectCollection();
        render();
        toast('Website settings saved.');
      }
    });
  });

  app.addEventListener('input', (event) => {
    const field = event.target.dataset.pageField;
    if (field && state.page) { state.page[field] = event.target.value; updateDirty(); }
    const seoField = event.target.dataset.seoField;
    if (seoField && state.page) { state.page.seo ||= {}; state.page.seo[seoField] = event.target.type === 'checkbox' ? event.target.checked : event.target.value; updateDirty(); }
    if (event.target.hasAttribute('data-seo-json') && state.page) { state.page._seoJson = event.target.value; updateDirty(); }
    if (event.target.closest('[data-form="import-zip"]') && event.target.type !== 'file') updateImportSummary();
  });

  app.addEventListener('change', (event) => {
    if (event.target.id === 'import-zip-file') {
      const file = event.target.files?.[0];
      const error = !file ? '' : file.size > 100 * 1024 * 1024 ? 'This ZIP is larger than 100 MB. Choose a smaller export.' : !file.size ? 'This file is empty. Choose a LumaSite ZIP export.' : !/\.zip$/i.test(file.name) && !['application/zip', 'application/x-zip-compressed'].includes(file.type) ? 'Choose a ZIP exported from LumaSite.' : '';
      state.importFile = error ? null : file || null;
      const slot = document.getElementById('form-error');
      slot.hidden = !error; slot.textContent = error;
      document.getElementById('import-file-detail').textContent = file && !error ? `${file.name} · ${formatBytes(file.size)}` : 'Choose a LumaSite export, up to 100 MB.';
      updateImportSummary();
    }
    if (event.target.name === 'linkMode' && event.target.closest('[data-form="import-zip"]')) updateImportSummary();
    if (event.target.id === 'project-select') {
      const id = event.target.value;
      run(async () => {
        if (!discardDraft()) { render(); return; }
        if (id) await selectProject(id, { checkDirty: false });
        else await navigate('projects');
      });
    }
    if (event.target.id === 'asset-file') {
      const files = Array.from(event.target.files || []);
      run(() => uploadFiles(files));
    }
  });

  app.addEventListener('dragover', (event) => {
    const zone = event.target.closest('#upload-zone');
    if (!zone) return;
    event.preventDefault();
    zone.classList.add('is-dragover');
  });
  app.addEventListener('dragleave', (event) => {
    const zone = event.target.closest('#upload-zone');
    if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove('is-dragover');
  });
  app.addEventListener('drop', (event) => {
    const zone = event.target.closest('#upload-zone');
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove('is-dragover');
    const files = Array.from(event.dataTransfer?.files || []);
    run(() => uploadFiles(files));
  });

  app.addEventListener('keydown', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (!tab || !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (state.busy) return;
    const tabs = Array.from(app.querySelectorAll('[role="tab"]'));
    const index = tabs.indexOf(tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    actions['source-tab'](tabs[next]);
  });

  document.addEventListener('cancel', (event) => {
    if (event.target instanceof HTMLDialogElement) {
      event.preventDefault();
      if (!state.busy) { state.modal = null; state.importFile = null; render(); }
    }
  }, true);

  document.addEventListener('keydown', (event) => {
    if (state.menuOpen && matchMedia('(max-width: 900px)').matches) {
      if (event.key === 'Escape') { event.preventDefault(); actions['toggle-menu'](); return; }
      if (event.key === 'Tab') {
        const controls = [...document.querySelectorAll('#studio-navigation a, #studio-navigation button:not(:disabled), #studio-navigation select:not(:disabled)')];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    if (event.key === 'Escape') {
      const links = document.querySelector('.quick-links[open]');
      if (links) { links.open = false; links.querySelector('summary')?.focus(); }
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && state.authenticated && state.page) {
      event.preventDefault();
      if (state.dirty) run(() => actions.save());
    }
  });

  document.addEventListener('click', (event) => {
    const links = document.querySelector('.quick-links[open]');
    if (links && !links.contains(event.target)) links.open = false;
  });
  matchMedia('(max-width: 900px)').addEventListener('change', () => { state.menuOpen = false; syncNavigation(); });

  window.addEventListener('beforeunload', (event) => {
    if (state.dirty) { event.preventDefault(); event.returnValue = ''; }
  });

  async function routeFromLocation() {
    const match = location.pathname.match(/^\/admin\/projects\/([^/]+)\/?$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      try { await selectProject(id, { push: false, checkDirty: false }); }
      catch (error) { state.view = 'projects'; state.project = null; state.page = null; markClean(); history.replaceState({}, '', '/admin'); render(); toast(error.message, true); }
    } else {
      state.project = null;
      state.page = null;
      state.view = 'projects';
      markClean();
      render();
    }
  }

  window.addEventListener('popstate', () => {
    if (!state.authenticated) return;
    if (!discardDraft()) { if (state.project) history.pushState({}, '', `/admin/projects/${encodeURIComponent(state.project.id)}`); return; }
    run(routeFromLocation);
  });

  async function boot() {
    try {
      const setup = await api('/api/setup');
      state.configured = Boolean(setup.configured);
      state.version = setup.version || '';
      state.port = setup.port || state.port;
      state.sitePort = setup.sitePort || state.sitePort;
      if (state.configured) {
        try { const session = await api('/api/session'); state.authenticated = Boolean(session.authenticated); }
        catch (error) { if (error.status !== 401) throw error; }
      }
      if (state.authenticated) { await loadProjects(); await routeFromLocation(); }
      else render();
    } catch (error) {
      app.innerHTML = `<main class="boot-screen" id="main"><span class="brand-symbol">L</span><h2>The studio could not connect.</h2><p style="max-width:45ch;text-align:center;padding:0 25px">${escape(error.message)}</p><button class="btn primary" id="boot-retry" type="button">Try again</button></main>`;
      document.getElementById('boot-retry')?.addEventListener('click', boot);
    }
  }

  boot();
})();
