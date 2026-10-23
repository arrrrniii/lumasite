import express from 'express';
import { createServer } from 'node:http';
import { access, readFile, mkdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';
import { compilePageCss, compilerHealth } from './compiler.mjs';
import { handleMcp } from './mcp.mjs';
import { exportProject, importProject } from './migration.mjs';
import { deleteProject } from './project-lifecycle.mjs';
import { listProjectBackups, readProjectBackup } from './project-backups.mjs';
import { createOAuthService } from './oauth.mjs';
import { projectRootPath, productionNavigation } from './public-links.mjs';
import { getIntegrations, updateIntegrations } from './integrations.mjs';
import { productionHost, pageNoindex, sitemapXml, robotsTxt, feedXml, renderBlogBlocks } from './seo.mjs';
import { VERSION, fail, tokenMatches, passwordMatches, publicInstance, publicProject, initializeInstance, createProject, requireProject, requirePage, getProjectUrls, updateProject, createPage, updatePage, publishPage, restorePage, rotateProjectToken, uploadAsset, getLibrary, getPreviewUrl, verifyPreviewToken, renderDocument } from './service.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const hash = text => createHash('sha256').update(String(text)).digest('hex');
const log = (event, details = {}) => process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), event, ...details })}\n`);
function getArg(name) { const index = process.argv.indexOf(`--${name}`); return index < 0 ? undefined : process.argv[index + 1]; }
function listen(server, port, host) {
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(server.address().port); }); });
}
function close(server) { return new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }

export async function startServers({ dataDir, store: suppliedStore } = {}) {
  const store = suppliedStore || await openStore(dataDir || process.env.LUMASITE_DATA_DIR || path.resolve('.lumasite'));
  const initial = store.read().instance;
  const config = initial || { id: null, host: '127.0.0.1', port: Number(process.env.PORT || 4310), sitePort: Number(process.env.LUMASITE_SITE_PORT || 4311), publicUrl: `http://localhost:${process.env.PORT || 4310}` };
  if (process.env.LUMASITE_HOST) config.host = process.env.LUMASITE_HOST;
  const sessions = new Map(), loginAttempts = new Map(), cssCache = new Map();
  const contentAssets = new Map(), revisionAssetUrls = new Map(), navigationCache = new Map();
  function productionHtml(revision, project, instance) {
    const key = JSON.stringify([revision.id, project.domain, instance?.sitePublicUrl]);
    if (!navigationCache.has(key)) {
      navigationCache.set(key, productionNavigation(revision.page.html, project, instance));
      if (navigationCache.size > 100) navigationCache.delete(navigationCache.keys().next().value);
    }
    return navigationCache.get(key);
  }
  function publishedAssetUrls(revision) {
    if (revisionAssetUrls.has(revision.id)) return revisionAssetUrls.get(revision.id);
    const urls = {};
    for (const [extension, body] of [['css', revision.compiledCss], ['js', revision.page.js]]) {
      const digest = hash(body);
      const filename = `${digest}.${extension}`;
      if (!contentAssets.has(filename)) contentAssets.set(filename, {
        body, type: extension === 'css' ? 'text/css' : 'text/javascript', etag: `"sha256-${digest}"`,
      });
      urls[extension] = `/content-assets/${filename}`;
    }
    revisionAssetUrls.set(revision.id, urls);
    return urls;
  }
  function findContentAsset(filename) {
    if (contentAssets.has(filename)) return contentAssets.get(filename);
    // Revisions are immutable published snapshots. Indexing only this collection
    // keeps drafts private and also supports a direct asset request after restart.
    for (const revision of store.read().revisions) {
      if (revisionAssetUrls.has(revision.id)) continue;
      publishedAssetUrls(revision);
      if (contentAssets.has(filename)) return contentAssets.get(filename);
    }
    return null;
  }
  const admin = express(), publicApp = express();
  const oauth = await createOAuthService(store, config.publicUrl);
  admin.disable('x-powered-by'); publicApp.disable('x-powered-by');
  let ready = false;
  const health = () => ({ status: 'ok', version: VERSION, instanceId: store.read().instance?.id || null, pid: process.pid, port: config.port, sitePort: config.sitePort, uptime: Math.floor(process.uptime()) });
  const allowedOrigins = () => new Set([config.publicUrl, `http://localhost:${config.port}`, `http://127.0.0.1:${config.port}`]);
  admin.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex,nofollow' });
    const hostname = req.hostname;
    if (!new Set(['localhost', '127.0.0.1', '[::1]', new URL(config.publicUrl).hostname]).has(hostname)) return res.status(403).json({ error: 'Unrecognized admin hostname. Configure the instance public URL.' });
    const publicOAuth = ['/authorize', '/token', '/register', '/revoke', '/.well-known/oauth-authorization-server'].includes(req.path) || req.path.startsWith('/.well-known/oauth-protected-resource');
    if (req.headers.origin && !allowedOrigins().has(req.headers.origin) && !publicOAuth) return res.status(403).json({ error: 'This origin cannot access the admin or MCP API.' });
    const started = performance.now();
    res.once('finish', () => log('request', { method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, durationMs: Math.round(performance.now() - started) }));
    next();
  });
  admin.get('/health', (_req, res) => res.json(health()));
  admin.get('/ready', async (_req, res) => { await access(store.dataDir, constants.W_OK); res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'starting' }); });
  admin.get('/robots.txt', (_req, res) => res.type('text').send('User-agent: *\nDisallow: /\n'));
  admin.use(oauth.router);
  admin.use(express.json({ limit: '72mb' }));
  function setSession(res) {
    const token = randomBytes(32).toString('base64url');
    sessions.set(hash(token), Date.now() + 12 * 60 * 60 * 1000);
    res.setHeader('Set-Cookie', `lumasite_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${config.publicUrl.startsWith('https:') ? '; Secure' : ''}`);
  }
  function authenticated(req) {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (tokenMatches(token, store.read().instance?.adminTokenHash)) return `admin:${hash(token)}`;
    const cookie = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('lumasite_session='))?.slice(17);
    return cookie && (sessions.get(hash(cookie)) || 0) > Date.now() ? `session:${hash(cookie)}` : null;
  }
  admin.get('/api/setup', (_req, res) => res.json({ configured: !!store.read().instance, version: VERSION, port: config.port, sitePort: config.sitePort }));
  admin.post('/api/setup', async (req, res) => {
    if (store.read().instance) fail(409, 'LumaSite is already initialized.');
    const result = await initializeInstance(store, { ...req.body, port: config.port, sitePort: config.sitePort, publicUrl: config.publicUrl });
    config.id = result.instance.id;
    setSession(res); res.status(201).json({ instance: result.instance, adminToken: result.adminToken });
  });
  admin.post('/api/login', (req, res) => {
    const instance = store.read().instance;
    if (!instance) fail(409, 'Complete setup first.');
    const key = req.socket.remoteAddress, attempts = loginAttempts.get(key) || { count: 0, since: Date.now() };
    if (Date.now() - attempts.since > 15 * 60 * 1000) { attempts.count = 0; attempts.since = Date.now(); }
    if (attempts.count >= 12) fail(429, 'Too many login attempts. Try again in 15 minutes.');
    if (!passwordMatches(req.body.password, instance.passwordHash)) { attempts.count += 1; loginAttempts.set(key, attempts); fail(401, 'The admin password is incorrect. Run lumasite credentials locally to recover it.'); }
    loginAttempts.delete(key); setSession(res); res.json({ authenticated: true });
  });
  admin.post('/api/logout', (req, res) => { const cookie = (req.headers.cookie || '').match(/(?:^|;\s*)lumasite_session=([^;]+)/)?.[1]; if (cookie) sessions.delete(hash(cookie)); res.setHeader('Set-Cookie', 'lumasite_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); res.json({ ok: true }); });
  admin.all('/mcp/:projectId', async (req, res) => {
    const project = requireProject(store.read(), req.params.projectId);
    const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (!tokenMatches(token, project.tokenHash)) {
      let authorized = false;
      if (typeof token === 'string' && token.startsWith('ls_oauth_')) {
        try { const auth = await oauth.provider.verifyAccessToken(token); authorized = auth.extra.projectId === project.id; } catch { /* Challenge invalid OAuth tokens. */ }
      }
      if (!authorized) return res.status(401).set('WWW-Authenticate', oauth.challenge(project.id)).json({ error: 'Connect with OAuth in ChatGPT, or use this website’s Bearer token in a client that supports custom headers.' });
    }
    await handleMcp(req, res, store, project.id);
  });
  admin.use('/api', (req, res, next) => {
    if (!authenticated(req)) return res.status(401).json({ error: 'Sign in to LumaSite first.' });
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.path.endsWith('/assets') && !(req.method === 'POST' && req.path === '/projects/import') && !req.is('application/json')) return res.status(415).json({ error: 'Send a JSON request body.' });
    next();
  });
  admin.get('/api/session', (_req, res) => res.json({ authenticated: true, instance: publicInstance(store.read().instance) }));
  admin.get('/api/oauth/requests/:id', (req, res) => res.json(oauth.requestDetails(req.params.id, authenticated(req))));
  admin.post('/api/oauth/requests/:id/decision', async (req, res) => res.json(await oauth.decide(req.params.id, authenticated(req), req.body)));
  admin.get('/api/projects/:id/connections', (req, res) => res.json({ connections: oauth.listConnections(req.params.id) }));
  admin.post('/api/projects/:id/connections/:connectionId/revoke', async (req, res) => res.json(await oauth.revokeConnection(req.params.id, req.params.connectionId)));
  admin.get('/api/projects', (_req, res) => { const state = store.read(); res.json({ projects: state.projects.map(p => ({ ...publicProject(p), urls: getProjectUrls(state, p) })) }); });
  admin.post('/api/projects', async (req, res) => res.status(201).json(await createProject(store, req.body)));
  admin.post('/api/projects/import', (req, _res, next) => {
    if (!req.is('application/zip')) fail(415, 'Upload a ZIP archive with Content-Type application/zip.');
    next();
  }, express.raw({ type: 'application/zip', limit: '100mb' }), async (req, res) => {
    const options = {}, allowed = new Set(['mode', 'projectId', 'confirmSlug', 'name', 'slug', 'domain', 'linkMode']);
    for (const [key, value] of Object.entries(req.query)) {
      if (!allowed.has(key) || typeof value !== 'string') fail(400, 'Use single, supported import option values.');
      options[key] = value;
    }
    const result = await importProject(store, req.body, options);
    if (result.mode === 'update') { contentAssets.clear(); revisionAssetUrls.clear(); cssCache.clear(); navigationCache.clear(); }
    log(result.mode === 'update' ? 'project.updated-from-zip' : 'project.imported', { projectId: result.project.id, pages: result.pages, assets: result.assets, revisions: result.revisions });
    res.status(result.mode === 'update' ? 200 : 201).json(result);
  });
  admin.get('/api/project-backups', (_req, res) => res.json({ backups: listProjectBackups(store) }));
  admin.get('/api/project-backups/:id/download', async (req, res) => {
    const result = await readProjectBackup(store, req.params.id);
    res.attachment(result.filename).type('application/zip').set('Cache-Control', 'no-store').send(result.buffer);
  });
  admin.post('/api/projects/:id/delete', async (req, res) => {
    const result = await deleteProject(store, req.params.id, req.body);
    contentAssets.clear(); revisionAssetUrls.clear(); cssCache.clear(); navigationCache.clear();
    log('project.deleted', { projectId: result.project.id, backupId: result.backup.id });
    res.json(result);
  });
  admin.get('/api/projects/:id/export', async (req, res) => {
    const result = await exportProject(store, req.params.id);
    res.attachment(result.filename).type('application/zip').set('Cache-Control', 'no-store').send(result.buffer);
  });
  admin.get('/api/projects/:id', (req, res) => { const state = store.read(), project = publicProject(requireProject(state, req.params.id)); res.json({ project, urls: getProjectUrls(state, project) }); });
  admin.patch('/api/projects/:id', async (req, res) => res.json(await updateProject(store, req.params.id, req.body)));
  admin.get('/api/projects/:id/integrations', (req, res) => res.json({ integrations: getIntegrations(requireProject(store.read(), req.params.id)) }));
  admin.patch('/api/projects/:id/integrations', async (req, res) => res.json(await updateIntegrations(store, req.params.id, req.body)));
  admin.post('/api/projects/:id/token', async (req, res) => res.json(await rotateProjectToken(store, req.params.id)));
  admin.get('/api/projects/:id/pages', (req, res) => { const state = store.read(); requireProject(state, req.params.id); res.json({ pages: state.pages.filter(p => p.projectId === req.params.id) }); });
  admin.post('/api/projects/:id/pages', async (req, res) => res.status(201).json({ page: await createPage(store, req.params.id, req.body) }));
  admin.get('/api/projects/:id/pages/:pageId', (req, res) => res.json({ page: requirePage(store.read(), req.params.id, req.params.pageId) }));
  admin.put('/api/projects/:id/pages/:pageId', async (req, res) => res.json({ page: await updatePage(store, req.params.id, req.params.pageId, req.body) }));
  admin.post('/api/projects/:id/pages/:pageId/publish', async (req, res) => { const result = await publishPage(store, req.params.id, req.params.pageId); log('page.published', { projectId: req.params.id, pageId: req.params.pageId, revisionId: result.revision.id }); res.json(result); });
  admin.get('/api/projects/:id/pages/:pageId/revisions', (req, res) => { const state = store.read(); requirePage(state, req.params.id, req.params.pageId); res.json({ revisions: state.revisions.filter(r => r.pageId === req.params.pageId).map(r => ({ id: r.id, number: r.number, createdAt: r.createdAt, title: r.page.title, slug: r.page.slug })).reverse() }); });
  admin.post('/api/projects/:id/pages/:pageId/restore', async (req, res) => res.json({ page: await restorePage(store, req.params.id, req.params.pageId, req.body.revisionId) }));
  admin.post('/api/projects/:id/preview', (req, res) => res.json({ url: getPreviewUrl(store.read(), req.params.id, req.body.pageId) }));
  admin.get('/api/projects/:id/assets', (req, res) => { const state = store.read(); requireProject(state, req.params.id); res.json({ assets: state.assets.filter(a => a.projectId === req.params.id) }); });
  admin.post('/api/projects/:id/assets', express.raw({ type: () => true, limit: '50mb' }), async (req, res) => {
    let name; try { name = decodeURIComponent(req.headers['x-filename'] || 'upload'); } catch { fail(400, 'Invalid filename encoding.'); }
    const asset = await uploadAsset(store, req.params.id, { name, mime: req.headers['content-type']?.split(';')[0], data: req.body }); res.status(201).json({ asset });
  });
  admin.get('/api/library', async (_req, res) => res.json(await getLibrary()));
  admin.get('/api/diagnostics', async (_req, res) => {
    const state = store.read(), library = await getLibrary();
    res.json({ ...health(), instance: publicInstance(state.instance), dataDir: store.dataDir, cliPath: path.join(root, 'bin/lumasite.mjs'), logPath: path.join(store.dataDir, 'logs/server.log'), projects: state.projects.length, pages: state.pages.length, assets: state.assets.length, lumafx: library.lumafx, checks: { storage: true, tailwind: await compilerHealth(), lumafx: !!library.lumafx, isolatedPublicOrigin: true }, commands: ['status', 'health', 'doctor', 'logs --follow', 'restart', 'stop'].map(c => `lumasite ${c} --data-dir ${JSON.stringify(store.dataDir)}`) });
  });
  admin.use('/admin-assets', express.static(path.join(root, 'public'), { fallthrough: false, index: false }));
  admin.use('/runtime/lumafx', express.static(path.join(root, 'vendor/lumafx'), { index: false, maxAge: '1h' }));
  admin.get('/oauth/consent', (_req, res) => {
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.sendFile(path.join(root, 'public/oauth.html'));
  });
  // Media is read-only on admin; source pages themselves never execute here.
  admin.get('/media/:projectId/:filename', async (req, res, next) => {
    if (!authenticated(req)) return res.status(401).end();
    return media(req, res, next);
  });
  admin.get(['/', '/admin', '/admin/{*path}'], (_req, res) => {
    const sitesOrigin = store.read().instance?.sitePublicUrl || `http://localhost:${config.sitePort}`;
    res.set('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; frame-src ${sitesOrigin} http://127.0.0.1:${config.sitePort}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`);
    res.sendFile(path.join(root, 'public/admin.html'));
  });
  function errors(error, req, res, _next) {
    const status = error.status || (error.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) log('error', { path: req.path, message: error.message });
    if (!res.headersSent) res.status(status).json({ error: status >= 500 ? 'LumaSite could not complete this request. Inspect lumasite logs for details.' : error.message });
  }
  admin.use((req, res) => res.status(404).json({ error: 'Route not found.' }));
  admin.use(errors);

  publicApp.use((_req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' }); next(); });
  publicApp.get('/health', (_req, res) => res.json(health()));
  publicApp.get('/runtime/integrations.js', (_req, res) => res.set('Cache-Control', 'public,max-age=3600').sendFile(path.join(root, 'public/integrations-runtime.js')));
  publicApp.use('/runtime/lumafx', express.static(path.join(root, 'vendor/lumafx'), { index: false, maxAge: '1h' }));
  function media(req, res, next) {
    const snapshot = store.read();
    const asset = snapshot.assets.find(a => a.projectId === req.params.projectId && a.filename === req.params.filename);
    if (!asset) return res.status(404).end();
    const project = snapshot.projects.find(p => p.id === asset.projectId);
    if (asset.mime.startsWith('image/') && project && productionHost(project, req.hostname) && !project.seo?.noindex) res.removeHeader('X-Robots-Tag');
    res.type(asset.mime).set({ 'Cache-Control': 'public,max-age=31536000,immutable', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(asset.name)}` });
    // Sandboxed studio previews have an opaque origin. Public fonts need CORS
    // permission there even though the same asset is same-origin on live pages.
    if (asset.mime === 'font/woff2') res.set('Access-Control-Allow-Origin', '*');
    res.sendFile(path.join(store.dataDir, 'media', asset.projectId, asset.filename), { dotfiles: 'allow' }, error => { if (error) next(error); });
  }
  publicApp.get('/media/:projectId/:filename', media);
  publicApp.get('/content-assets/:asset', (req, res) => {
    if (!/^[a-f0-9]{64}\.(?:css|js)$/.test(req.params.asset)) return res.status(404).end();
    const asset = findContentAsset(req.params.asset);
    if (!asset) return res.status(404).end();
    res.type(asset.type).set({ 'Cache-Control': 'public,max-age=31536000,immutable', ETag: asset.etag }).send(asset.body);
  });
  publicApp.get('/release-assets/:asset', (req, res) => {
    const match = req.params.asset.match(/^([a-f0-9-]+)\.(css|js)$/);
    const revision = match && store.read().revisions.find(r => r.id === match[1]);
    if (!revision) return res.status(404).end();
    res.type(match[2] === 'css' ? 'text/css' : 'text/javascript').set('Cache-Control', 'public,max-age=31536000,immutable').send(match[2] === 'css' ? revision.compiledCss : revision.page.js);
  });
  async function previewCss(page) {
    const key = `${page.id}:${page.revision}`;
    if (!cssCache.has(key)) {
      cssCache.set(key, compilePageCss(page.html, page.css, page.js));
      if (cssCache.size > 100) cssCache.delete(cssCache.keys().next().value);
    }
    return cssCache.get(key);
  }
  publicApp.get('/preview-assets/:projectId/:asset', async (req, res) => {
    const match = req.params.asset.match(/^([a-f0-9-]+)\.(css|js)$/), state = store.read();
    if (!match || !verifyPreviewToken(state, req.query.token, req.params.projectId, match[1])) fail(403, 'This preview link is invalid or expired. Refresh the preview in the studio.');
    const page = requirePage(state, req.params.projectId, match[1]);
    res.type(match[2] === 'css' ? 'text/css' : 'text/javascript').set({ 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }).send(match[2] === 'css' ? await previewCss(page) : page.js);
  });
  publicApp.get('/preview/:projectId/:pageId', async (req, res) => {
    const state = store.read();
    if (!verifyPreviewToken(state, req.query.token, req.params.projectId, req.params.pageId)) fail(403, 'This preview link is invalid or expired. Refresh the preview in the studio.');
    const page = requirePage(state, req.params.projectId, req.params.pageId), project = requireProject(state, req.params.projectId);
    const html = renderBlogBlocks(page.html, state, project, `/sites/${project.slug}/`, page.slug);
    res.set('Cache-Control', 'no-store').type('html').send(renderDocument(page, { preview: true, theme: project.theme, token: req.query.token, project, instance: state.instance, html }));
  });
  function servePublished(req, res, project, slug) {
    const state = store.read();
    const current = state.pages.find(p => p.projectId === project.id && p.publishedRevisionId && state.revisions.find(r => r.id === p.publishedRevisionId)?.page.slug === slug);
    const revision = current && state.revisions.find(r => r.id === current.publishedRevisionId);
    if (!revision) return res.status(404).type('html').send('<!doctype html><html><head><title>Not published yet</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font:16px system-ui;padding:60px;max-width:600px;margin:auto"><h1>This page is not published yet.</h1><p>Open the page in LumaSite and choose Publish. Draft changes stay private until you publish them.</p></body></html>');
    const localPath = req.path.startsWith(`/sites/${project.slug}/`) || req.path === `/sites/${project.slug}`;
    const noindex = localPath || !productionHost(project, req.hostname);
    if (pageNoindex(revision.page, project, noindex)) res.set('X-Robots-Tag', 'noindex,follow');
    else res.removeHeader('X-Robots-Tag');
    const basePath = localPath ? `/sites/${project.slug}/` : '/';
    const source = !localPath && project.domain === req.hostname ? productionHtml(revision, project, state.instance) : revision.page.html;
    const html = renderBlogBlocks(source, state, project, basePath, revision.page.slug);
    res.set('Cache-Control', 'no-cache').type('html').send(renderDocument(revision.page, { revisionId: revision.id, theme: revision.theme, assetUrls: publishedAssetUrls(revision), project, instance: state.instance, noindex, liveIntegrations: !noindex, html }));
  }
  function seoResource(req, res, project, resource, localPath = false) {
    const state = store.read(), production = !localPath && productionHost(project, req.hostname);
    res.set('Cache-Control', 'no-cache');
    if (resource === 'robots.txt') return res.type('text').send(robotsTxt(project, state.instance, production));
    if (production && !project.seo?.noindex) res.removeHeader('X-Robots-Tag');
    return res.type(resource === 'feed.xml' ? 'application/rss+xml' : 'application/xml').send(resource === 'feed.xml' ? feedXml(state, project) : sitemapXml(state, project));
  }
  publicApp.get(['/robots.txt', '/sitemap.xml', '/feed.xml'], (req, res) => {
    const project = store.read().projects.find(p => p.domain === req.hostname);
    if (!project) return req.path === '/robots.txt' ? res.type('text').send('User-agent: *\nDisallow: /\n') : res.status(404).end();
    return seoResource(req, res, project, req.path.slice(1));
  });
  publicApp.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end();
    const localMatch = req.path.match(/^\/sites\/([^/]+)(?:\/(.*))?$/);
    if (localMatch) {
      const project = store.read().projects.find(p => p.slug === localMatch[1]);
      if (!project) fail(404, 'Project not found.');
      if (project.domain && project.domain === req.hostname) {
        const target = projectRootPath(req.path, project.slug);
        if (target === null) return res.status(404).end();
        const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
        res.removeHeader('X-Robots-Tag');
        return res.status(301).set({ Location: `${target}${query}`, 'Cache-Control': 'no-cache' }).end();
      }
      if (['robots.txt', 'sitemap.xml', 'feed.xml'].includes(localMatch[2])) return seoResource(req, res, project, localMatch[2], true);
      return servePublished(req, res, project, (localMatch[2] || '').replace(/\/$/, ''));
    }
    const project = store.read().projects.find(p => p.domain && p.domain === req.hostname);
    if (project) return servePublished(req, res, project, req.path.replace(/^\/+|\/+$/g, ''));
    next();
  });
  publicApp.use((_req, res) => res.status(404).json({ error: 'Public site not found. Use the site URL shown in LumaSite Connections.' }));
  publicApp.use(errors);

  const adminServer = createServer(admin), siteServer = createServer(publicApp);
  let adminPort, sitePort;
  try { adminPort = await listen(adminServer, config.port, config.host); sitePort = await listen(siteServer, config.sitePort, config.host); }
  catch (error) { await Promise.all([close(adminServer), close(siteServer)]); throw error; }
  ready = true;
  log('server.started', { ...health(), adminUrl: config.publicUrl, siteUrl: store.read().instance?.sitePublicUrl || `http://localhost:${sitePort}`, dataDir: store.dataDir });
  return { store, adminServer, siteServer, ports: { admin: adminPort, site: sitePort }, async close() { ready = false; await Promise.all([close(adminServer), close(siteServer)]); log('server.stopped'); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let servers;
  try { servers = await startServers({ dataDir: getArg('data-dir') }); }
  catch (error) { log('server.failed', { message: error.message, code: error.code }); process.exitCode = 1; }
  if (servers) {
    let stopping = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (stopping) return; stopping = true; await servers.close(); process.exit(0); });
  }
}
