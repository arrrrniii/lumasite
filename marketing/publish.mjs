import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { home } from './home.mjs';
import { pages } from './pages.mjs';
import { layout } from './shared.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const instanceDirectory = process.env.LUMASITE_DATA_DIR ? path.resolve(process.env.LUMASITE_DATA_DIR) : path.resolve(directory, '..', '.lumasite');
const apiOrigin = process.env.LUMASITE_MARKETING_API || 'http://127.0.0.1:4310';
const urlMode = process.env.LUMASITE_MARKETING_URL_MODE || 'project';
if (!['project', 'domain'].includes(urlMode)) throw new Error('LUMASITE_MARKETING_URL_MODE must be project or domain.');
// Credentials stay local and are never included in HTML or publication reports.
const credentials = JSON.parse(await readFile(path.join(instanceDirectory, 'credentials.json'), 'utf8'));
async function api(route, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${apiOrigin}${route}`, {
    method,
    headers: { Authorization: `Bearer ${credentials.adminToken}`, ...(body !== undefined && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${method} ${route}: ${result.error || response.status}`);
  return result;
}

const before = await api('/health');
const { projects } = await api('/api/projects');
const project = projects.find(item => item.slug === 'sendmailos');
if (!project) throw new Error('Create the SendMailOS project before publishing the marketing site.');
if (urlMode === 'domain' && !project.domain) throw new Error('Set the project domain before publishing domain URLs.');
const publicURL = urlMode === 'domain' ? project.urls.production : project.urls.site;
const projectRoute = `/api/projects/${project.id}`;
const { assets } = await api(`${projectRoute}/assets`);
const { pages: existingPages } = await api(`${projectRoute}/pages`);
let previousReport;
try { previousReport = JSON.parse(await readFile(path.join(directory, 'published.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
// Do not silently replace edits made through the studio or MCP since this
// source tree was last published. Bring those edits into source first.
for (const tracked of previousReport?.pages || []) {
  const current = existingPages.find(page => page.id === tracked.pageId);
  if (!current || current.publishedRevisionId !== tracked.revisionId || (tracked.draftRevision !== undefined && current.revision !== tracked.draftRevision)) {
    throw new Error(`/${tracked.slug} changed outside the marketing source. Sync the studio/MCP edits into source before publishing.`);
  }
}

async function uploadFile(filename, mime, label = path.basename(filename)) {
  const bytes = await readFile(path.join(directory, filename));
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  const extension = path.extname(filename);
  const name = `sendmailos-${path.basename(filename, extension)}-${digest}${extension}`;
  const existing = assets.find(asset => asset.name === name);
  if (existing) return existing;
  const { asset } = await api(`${projectRoute}/assets`, { method: 'POST', body: bytes, headers: { 'Content-Type': mime, 'X-Filename': encodeURIComponent(name) } });
  console.log(`Uploaded ${label} (${Math.round(bytes.length / 1024)} KB)`);
  return asset;
}

async function image(baseName) {
  let extension = 'webp';
  try { await access(path.join(directory, 'assets', `${baseName}.webp`)); }
  catch { extension = 'png'; }
  return uploadFile(`assets/${baseName}.${extension}`, extension === 'webp' ? 'image/webp' : 'image/png', baseName);
}

const hero = await image('mail-hero-v3');
const heroMobile = await image('mail-hero-v3-mobile');
const founder = await image('founder');
const sectionArt = {};
for (const [key, basename] of Object.entries({
  CAMPAIGN_ART: 'campaign-art-v1',
  TEMPLATE_ART: 'template-art-v1',
  INBOX_ART: 'inbox-art-v1',
  WORKFLOW_ART: 'workflow-art-v1',
  PIXEL_ART: 'pixel-art-v1',
  CONNECTION_BG: 'connection-bg-v1',
})) {
  sectionArt[key] = await image(basename);
  const variant = key === 'CONNECTION_BG' ? 'MOBILE' : 'SMALL';
  sectionArt[`${key}_${variant}`] = await image(`${basename}-${variant.toLowerCase()}`);
}
const sora = await uploadFile('assets/fonts/soravariable.woff2', 'font/woff2', 'Sora variable font');
const dmSans = await uploadFile('assets/fonts/dmsansvariable.woff2', 'font/woff2', 'DM Sans variable font');
const [baseCss, darkCss, sceneCss, typographyCss, cardCss, artCss, effectCss, sectionArtCss, navigationCss, js] = await Promise.all([
  readFile(path.join(directory, 'styles.css'), 'utf8'),
  readFile(path.join(directory, 'dark-theme.css'), 'utf8'),
  readFile(path.join(directory, 'visual-scenes.css'), 'utf8'),
  readFile(path.join(directory, 'typography.css'), 'utf8'),
  readFile(path.join(directory, 'platform-cards.css'), 'utf8'),
  readFile(path.join(directory, 'art-direction.css'), 'utf8'),
  readFile(path.join(directory, 'effects.css'), 'utf8'),
  readFile(path.join(directory, 'section-art.css'), 'utf8'),
  readFile(path.join(directory, 'navigation.css'), 'utf8'),
  readFile(path.join(directory, 'motion.js'), 'utf8'),
]);
const css = [baseCss, darkCss, sceneCss, typographyCss, cardCss, artCss, effectCss, sectionArtCss, navigationCss].join('\n\n')
  .replaceAll('__SORA_FONT__', sora.url).replaceAll('__DM_SANS_FONT__', dmSans.url);

function prepareHTML(page) {
  let html = layout(page).replaceAll('__HERO_IMAGE__', hero.url).replaceAll('__HERO_MOBILE_IMAGE__', heroMobile.url).replaceAll('__FOUNDER_IMAGE__', founder.url);
  for (const [key, asset] of Object.entries(sectionArt)) html = html.replaceAll(`__${key}__`, asset.url);
  if (/__[A-Z_]+__/.test(html)) throw new Error(`Unresolved asset in ${page.slug || 'home'}`);
  // The same published revision works through local path routing and a domain.
  return urlMode === 'domain' ? html : html.replace(/href="(\/(?!\/)[^"]*)"/g, (_, href) => `href="/sites/${project.slug}${href}"`);
}

const report = {
  publishedAt: new Date().toISOString(),
  projectId: project.id,
  project: project.name,
  localURL: project.urls.site,
  urlMode,
  publicURL,
  runtimePid: before.pid,
  assets: { hero: hero.url, heroMobile: heroMobile.url, founder: founder.url, sora: sora.url, dmSans: dmSans.url, sectionArt: Object.fromEntries(Object.entries(sectionArt).map(([key, asset]) => [key, asset.url])) },
  pages: [],
};

// Publish destinations before the homepage starts linking to them.
for (const definition of [...pages, home]) {
  const source = { title: definition.title, slug: definition.slug, description: definition.description, html: prepareHTML(definition), css, js };
  let page = existingPages.find(item => item.slug === definition.slug);
  const changed = !page || Object.entries(source).some(([key, value]) => page[key] !== value);
  if (!page) ({ page } = await api(`${projectRoute}/pages`, { method: 'POST', body: source }));
  else if (changed) ({ page } = await api(`${projectRoute}/pages/${page.id}`, { method: 'PUT', body: { ...source, revision: page.revision } }));
  let revisionId = page.publishedRevisionId;
  if (changed || !revisionId) {
    const published = await api(`${projectRoute}/pages/${page.id}/publish`, { method: 'POST', body: {} });
    revisionId = published.revision.id;
  }
  report.pages.push({ slug: page.slug, title: page.title, pageId: page.id, revisionId, draftRevision: page.revision, url: `${publicURL}${page.slug}` });
  console.log(`${changed ? 'Published' : 'Unchanged'} /${page.slug}`);
}

const after = await api('/health');
if (after.pid !== before.pid) throw new Error('The runtime restarted unexpectedly during publication.');
await writeFile(path.join(directory, 'published.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Published ${report.pages.length} pages. Runtime PID ${before.pid} stayed running.`);
console.log(publicURL);
