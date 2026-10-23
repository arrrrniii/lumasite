import { randomBytes, randomUUID, createHash, timingSafeEqual, scryptSync, createHmac } from 'node:crypto';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite } from './store.mjs';
import { compilePageCss } from './compiler.mjs';
import { homePage, escapeHtml, components } from './templates.mjs';
import { validateSeo, renderSeo } from './seo.mjs';
import { integrationMarkup } from './integrations.mjs';
import { composeLayout, pageLayout, layoutModeSchema, layoutClassSchema, parseLayout } from './layout.mjs';

export const VERSION = '0.10.0';
export function fail(status, message) { throw Object.assign(new Error(message), { status }); }
export const tokenHash = token => createHash('sha256').update(String(token)).digest('hex');
export function tokenMatches(token, hash) {
  if (!token || !hash) return false;
  const left = Buffer.from(tokenHash(token)), right = Buffer.from(hash);
  return left.length === right.length && timingSafeEqual(left, right);
}
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function passwordMatches(password, hash) {
  if (typeof password !== 'string' || password.length > 1024 || !hash) return false;
  const [salt, expected] = hash.split(':');
  const actual = scryptSync(password, salt, 64), target = Buffer.from(expected, 'hex');
  return actual.length === target.length && timingSafeEqual(actual, target);
}
export function publicInstance(instance) {
  if (!instance) return null;
  const { passwordHash: _p, adminTokenHash: _t, ...result } = instance;
  return result;
}
export function publicProject(project, { includeLayoutSource = false } = {}) {
  const { tokenHash: _t, layout, ...result } = project;
  if (layout) result.layout = includeLayoutSource ? layout : { revision: layout.revision, publishedRevisionId: layout.published?.id || null, publishedAt: layout.published?.createdAt || null };
  return result;
}
function text(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, `${label} must contain 1–${max} characters.`);
  return value.trim();
}
function domainName(value) {
  if (!value) return '';
  let domain = String(value).trim().toLowerCase().replace(/\.$/, '');
  if (domain.includes('://')) {
    try { const u = new URL(domain); if (u.pathname !== '/' || u.search || u.hash || u.port) fail(400, 'Enter a domain without a path or port.'); domain = u.hostname; }
    catch { fail(400, 'Enter a valid domain, such as example.com.'); }
  }
  if (domain.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)) fail(400, 'Enter a valid domain, such as example.com.');
  return domain;
}
function pageSlug(value = '') {
  const slug = String(value).replace(/^\/+|\/+$/g, '');
  if (slug.length > 300 || (slug && !/^[a-z0-9]+(?:[/-][a-z0-9]+)*$/.test(slug))) fail(400, 'Page paths can contain lowercase letters, numbers, hyphens and nested slashes.');
  if (new Set(['health', 'runtime', 'media', 'content-assets', 'layout-assets', 'release-assets', 'preview-assets', 'preview', 'sites', 'admin', 'api', 'mcp']).has(slug.split('/')[0])) fail(400, 'That path is reserved by LumaSite. Choose another page path.');
  return slug;
}
function source(value, label, max = 1024 * 1024) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > max) fail(400, `${label} must be text smaller than ${max / 1024} KB.`);
  return value;
}
const credentialQueues = new WeakMap();
async function updateCredentials(store, fn) {
  const operation = (credentialQueues.get(store) || Promise.resolve()).then(async () => {
    const filename = path.join(store.dataDir, 'credentials.json');
    let credentials = {};
    try { credentials = JSON.parse(await readFile(filename, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    fn(credentials);
    await atomicWrite(filename, JSON.stringify(credentials, null, 2));
  });
  credentialQueues.set(store, operation.catch(() => {}));
  return operation;
}
export async function rememberProjectToken(store, projectId, token) {
  return updateCredentials(store, credentials => {
    credentials.projectTokens ||= {};
    if (token === null) delete credentials.projectTokens[projectId];
    else credentials.projectTokens[projectId] = token;
  });
}
export async function initializeInstance(store, options = {}) {
  const port = Number(options.port ?? 4310), sitePort = Number(options.sitePort ?? port + 1);
  if (![port, sitePort].every(p => Number.isInteger(p) && p >= 1024 && p <= 65535) || port === sitePort) fail(400, 'Choose two different ports between 1024 and 65535.');
  const password = options.password || randomBytes(18).toString('base64url');
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) fail(400, 'Use an admin password of at least 12 characters.');
  const adminToken = `ls_admin_${randomBytes(32).toString('base64url')}`;
  let publicUrl, sitePublicUrl;
  try {
    const u = new URL(options.publicUrl || `http://localhost:${port}`);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw new Error();
    publicUrl = u.origin;
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    const site = new URL(options.sitePublicUrl || (local ? `http://localhost:${sitePort}` : `https://sites.${u.hostname}`));
    if (!['http:', 'https:'].includes(site.protocol) || site.username || site.password || site.pathname !== '/' || site.search || site.hash || site.origin === publicUrl) throw new Error();
    sitePublicUrl = site.origin;
  } catch { fail(400, 'The admin public URL must be an HTTP(S) origin without a path.'); }
  const instance = await store.mutate(state => {
    if (state.instance) fail(409, 'LumaSite is already initialized. Use the login screen or lumasite credentials.');
    state.instance = { id: randomUUID(), host: options.host || '127.0.0.1', port, sitePort, publicUrl, sitePublicUrl, createdAt: new Date().toISOString(), passwordHash: hashPassword(password), adminTokenHash: tokenHash(adminToken) };
    return publicInstance(state.instance);
  });
  await updateCredentials(store, c => Object.assign(c, { adminPassword: password, adminToken, projectTokens: {} }));
  return { instance, password, adminToken };
}
export function requireProject(state, projectId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) fail(404, 'Project not found.');
  return project;
}
export function requirePage(state, projectId, pageId) {
  requireProject(state, projectId);
  const page = state.pages.find(p => p.id === pageId && p.projectId === projectId);
  if (!page) fail(404, 'Page not found in this project.');
  return page;
}
export function getProjectUrls(state, project) {
  const instance = state.instance;
  const publicOrigin = instance.sitePublicUrl || `http://localhost:${instance.sitePort}`;
  return { admin: `${instance.publicUrl}/admin/projects/${project.id}`, mcp: `${instance.publicUrl}/mcp/${project.id}`, site: `${publicOrigin}/sites/${project.slug}/`, production: project.domain ? `https://${project.domain}/` : null };
}
function newPage(projectId, data) {
  return { id: randomUUID(), projectId, slug: pageSlug(data.slug), title: text(data.title || 'Untitled page', 'Page title'), description: String(data.description || '').slice(0, 500), seo: validateSeo(data.seo), ...(data.layoutMode !== undefined ? { layoutMode: parseLayout(layoutModeSchema, data.layoutMode), layoutClass: parseLayout(layoutClassSchema, data.layoutClass || '') } : {}), html: source(data.html || '', 'HTML'), css: source(data.css || '', 'CSS'), js: source(data.js || '', 'JavaScript'), updatedAt: new Date().toISOString(), revision: 1, publishedRevisionId: null };
}
export async function createProject(store, data) {
  const name = text(data.name, 'Project name', 100), domain = domainName(data.domain);
  const slug = String(data.slug || name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).slice(0, 80);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fail(400, 'Choose a project slug using lowercase letters, numbers and hyphens.');
  const token = `ls_project_${randomBytes(32).toString('base64url')}`;
  const project = await store.mutate(state => {
    if (!state.instance) fail(409, 'Initialize LumaSite first.');
    if (state.projects.some(p => p.slug === slug || (domain && p.domain === domain))) fail(409, 'This project slug or domain is already in use.');
    const now = new Date().toISOString();
    const p = { id: randomUUID(), name, domain, slug, tokenHash: tokenHash(token), theme: {}, seo: validateSeo(data.seo, true), createdAt: now, updatedAt: now };
    state.projects.push(p);
    state.pages.push(newPage(p.id, homePage(name)));
    return publicProject(p);
  });
  await updateCredentials(store, c => { c.projectTokens ||= {}; c.projectTokens[project.id] = token; });
  return { project, token, urls: getProjectUrls(store.read(), project) };
}
export async function updateProject(store, projectId, data) {
  const project = await store.mutate(state => {
    const p = requireProject(state, projectId);
    if ('name' in data) p.name = text(data.name, 'Project name', 100);
    if ('domain' in data) {
      const domain = domainName(data.domain);
      if (domain && state.projects.some(other => other.id !== projectId && other.domain === domain)) fail(409, 'That domain belongs to another project.');
      p.domain = domain;
    }
    if ('theme' in data) {
      if (!data.theme || typeof data.theme !== 'object' || Array.isArray(data.theme)) fail(400, 'Theme must be an object of CSS variables.');
      for (const [key, value] of Object.entries(data.theme)) {
        if (!/^--[a-z][a-z0-9-]{0,60}$/.test(key) || typeof value !== 'string' || value.length > 200 || /[;{}<>]/.test(value)) fail(400, 'Theme entries must be CSS variables with simple CSS values.');
      }
      p.theme = { ...data.theme };
    }
    if ('seo' in data) p.seo = validateSeo(data.seo, true);
    p.updatedAt = new Date().toISOString();
    return publicProject(p);
  });
  return { project, urls: getProjectUrls(store.read(), project) };
}
export async function rotateProjectToken(store, projectId) {
  const token = `ls_project_${randomBytes(32).toString('base64url')}`;
  await store.mutate(state => { requireProject(state, projectId).tokenHash = tokenHash(token); });
  await updateCredentials(store, c => { c.projectTokens ||= {}; c.projectTokens[projectId] = token; });
  return { token };
}
export async function createPage(store, projectId, data) {
  return store.mutate(state => {
    const project = requireProject(state, projectId);
    const page = newPage(projectId, { ...(project.layout?.published ? { layoutMode: 'global' } : {}), ...data });
    if (state.pages.some(p => p.projectId === projectId && p.slug === page.slug)) fail(409, 'A page already uses this path.');
    state.pages.push(page); return page;
  });
}
export async function updatePage(store, projectId, pageId, data) {
  return store.mutate(state => {
    const p = requirePage(state, projectId, pageId);
    if (data.revision !== undefined && Number(data.revision) !== p.revision) fail(409, 'This page changed in another session. Reload it before saving.');
    if ('title' in data) p.title = text(data.title, 'Page title');
    if ('description' in data) p.description = String(data.description).slice(0, 500);
    if ('seo' in data) p.seo = validateSeo(data.seo);
    if ('slug' in data) {
      const slug = pageSlug(data.slug);
      if (state.pages.some(other => other.projectId === projectId && other.id !== pageId && other.slug === slug)) fail(409, 'A page already uses this path.');
      p.slug = slug;
    }
    if ('layoutMode' in data) p.layoutMode = parseLayout(layoutModeSchema, data.layoutMode);
    if ('layoutClass' in data) p.layoutClass = parseLayout(layoutClassSchema, data.layoutClass);
    for (const key of ['html', 'css', 'js']) if (key in data) p[key] = source(data[key], key.toUpperCase());
    p.updatedAt = new Date().toISOString(); p.revision += 1;
    return p;
  });
}
export async function publishPage(store, projectId, pageId) {
  const state = store.read(), page = requirePage(state, projectId, pageId), project = requireProject(state, projectId);
  if (page.layoutMode === 'global' && !project.layout?.published) fail(409, 'Publish the global layout before publishing a page that uses it.');
  composeLayout(page.html, page, pageLayout(project, page));
  const compiledCss = await compilePageCss(page.html + `<div class="${escapeHtml(page.layoutClass || '')}"></div>`, page.css, page.js);
  return store.mutate(next => {
    const current = requirePage(next, projectId, pageId);
    if (current.revision !== page.revision) fail(409, 'The page changed during publishing. Publish again to include the latest changes.');
    const routeOwner = next.pages.find(p => p.projectId === projectId && p.id !== pageId && p.publishedRevisionId && next.revisions.find(r => r.id === p.publishedRevisionId)?.page.slug === page.slug);
    if (routeOwner) fail(409, `The live path /${page.slug} belongs to “${routeOwner.title}”. Publish that page at its new path before reusing this one.`);
    const revision = { id: randomUUID(), projectId, pageId, createdAt: new Date().toISOString(), number: next.revisions.filter(r => r.pageId === pageId).length + 1, page: structuredClone(page), theme: structuredClone(project.theme), compiledCss };
    next.revisions.push(revision);
    current.publishedRevisionId = revision.id;
    return { page: current, revision: { id: revision.id, createdAt: revision.createdAt, number: revision.number }, url: `${getProjectUrls(next, project).site}${page.slug}` };
  });
}
export async function restorePage(store, projectId, pageId, revisionId) {
  return store.mutate(state => {
    const page = requirePage(state, projectId, pageId);
    const revision = state.revisions.find(r => r.id === revisionId && r.projectId === projectId && r.pageId === pageId);
    if (!revision) fail(404, 'Published revision not found.');
    if (state.pages.some(other => other.projectId === projectId && other.id !== pageId && other.slug === revision.page.slug)) fail(409, 'Another draft uses the path from this revision. Change that page’s path before restoring.');
    for (const key of ['html', 'css', 'js', 'title', 'description', 'slug']) page[key] = revision.page[key];
    page.seo = structuredClone(revision.page.seo || {});
    page.layoutMode = revision.page.layoutMode || 'none'; page.layoutClass = revision.page.layoutClass || '';
    page.updatedAt = new Date().toISOString(); page.revision += 1;
    return page;
  });
}
export function previewToken(state, projectId, pageId) {
  requirePage(state, projectId, pageId);
  const payload = Buffer.from(JSON.stringify({ projectId, pageId, exp: Date.now() + 10 * 60 * 1000 })).toString('base64url');
  return `${payload}.${createHmac('sha256', state.instance.adminTokenHash).update(payload).digest('base64url')}`;
}
export function verifyPreviewToken(state, token, projectId, pageId) {
  try {
    const [payload, sig] = String(token).split('.');
    const expected = createHmac('sha256', state.instance.adminTokenHash).update(payload).digest('base64url');
    if (!sig || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return claims.projectId === projectId && claims.pageId === pageId && claims.exp > Date.now();
  } catch { return false; }
}
export function getPreviewUrl(state, projectId, pageId) {
  return `${state.instance.sitePublicUrl || `http://localhost:${state.instance.sitePort}`}/preview/${projectId}/${pageId}?token=${previewToken(state, projectId, pageId)}`;
}
const mediaTypes = new Map([['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'], ['image/gif', 'gif'], ['image/avif', 'avif'], ['video/mp4', 'mp4'], ['video/webm', 'webm'], ['audio/mpeg', 'mp3'], ['audio/wav', 'wav'], ['audio/ogg', 'ogg'], ['audio/mp4', 'm4a'], ['font/woff2', 'woff2']]);
export async function uploadAsset(store, projectId, { name, mime, data }) {
  const project = requireProject(store.read(), projectId);
  const ext = mediaTypes.get(mime);
  if (!ext) fail(400, 'Supported uploads: PNG, JPEG, WebP, GIF, AVIF, MP4, WebM, MP3, WAV, OGG, M4A, WOFF2.');
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, 'base64');
  if (!bytes.length || bytes.length > 50 * 1024 * 1024) fail(400, 'Upload a non-empty file smaller than 50 MB.');
  const id = randomUUID(), filename = `${id}.${ext}`, folder = path.join(store.dataDir, 'media', projectId);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await writeFile(path.join(folder, filename), bytes, { flag: 'wx', mode: 0o600 });
  const asset = { id, projectId, name: String(name || filename).slice(0, 200), filename, mime, size: bytes.length, createdAt: new Date().toISOString(), url: `/media/${projectId}/${filename}` };
  try {
    await store.mutate(state => {
      const current = requireProject(state, projectId);
      if (current.updatedAt !== project.updatedAt) fail(409, 'This website changed during upload. Refresh and upload again.');
      state.assets.push(asset);
    });
  } catch (error) { await rm(path.join(folder, filename), { force: true }); throw error; }
  return asset;
}
export async function getLibrary() {
  let animations = [], lumafx = null;
  try { const manifest = JSON.parse(await readFile(new URL('../vendor/lumafx/manifest.json', import.meta.url), 'utf8')); animations = manifest.animations || []; lumafx = { version: manifest.version, commit: manifest.commit }; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { components, animations, lumafx };
}
export function renderDocument(page, { theme = {}, revisionId, preview = false, token = '', assetUrls, project, instance, noindex = false, liveIntegrations = false, html = page.html, layoutComposed = false } = {}) {
  const id = revisionId || `${page.id}-${page.revision}`;
  const prefix = preview ? `/preview-assets/${page.projectId}/${page.id}` : `/release-assets/${id}`;
  const themeCss = Object.entries(theme).map(([key, value]) => `${key}:${value}`).join(';');
  const metadata = renderSeo(page, { project, instance, preview, noindex });
  const query = preview ? `?token=${encodeURIComponent(token)}&revision=${page.revision}` : '';
  const cssUrl = !preview && assetUrls?.css || `${prefix}.css${query}`;
  const jsUrl = !preview && assetUrls?.js || `${prefix}.js${query}`;
  const integrations = integrationMarkup(project, liveIntegrations && !preview);
  const layout = pageLayout(project, page, preview);
  if (!layoutComposed) html = composeLayout(html, page, layout);
  const layoutPrefix = preview ? `/preview-assets/${page.projectId}/${page.id}.layout` : `/layout-assets/${layout?.id}`;
  const layoutCss = layout ? `<link rel="stylesheet" href="${escapeHtml(layoutPrefix + '.css' + query)}">` : '';
  const layoutAfter = layout?.cssAfter ? `<link rel="stylesheet" href="${escapeHtml(layoutPrefix + (preview ? '-after.css' : '.after.css') + query)}">` : '';
  const layoutJs = layout?.js ? `<script type="module" src="${escapeHtml(layoutPrefix + '.js' + query)}"></script>` : '';
  return `<!doctype html><html lang="${escapeHtml(metadata.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${integrations.head}${metadata.head}<link rel="stylesheet" href="/runtime/lumafx/lumafx.css">${layoutCss}<link rel="stylesheet" href="${escapeHtml(cssUrl)}">${layoutAfter}<style>:root{${themeCss}}</style><script src="/runtime/lumafx/lumafx.global.js"></script></head><body>${integrations.bodyStart}${html}${layoutJs}<script type="module" src="${escapeHtml(jsUrl)}"></script>${integrations.bodyEnd}</body></html>`;
}
