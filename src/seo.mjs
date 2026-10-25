import { z } from 'zod';
import { escapeHtml } from './templates.mjs';
import { languageSettings, pageLocale, localePrefix, translationAlternates } from './i18n.mjs';

const short = max => z.string().trim().max(max);
function webUrl(value, relative = false) {
  if (!value) return true;
  if (relative && /^\/(?!\/)/.test(value) && !/[\\\s<>]/.test(value)) return true;
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password; }
  catch { return false; }
}
const image = short(2048).refine(value => webUrl(value, true), 'Use an HTTP(S) URL or root-relative media path.');
const canonical = short(2048).refine(value => webUrl(value), 'Use an absolute HTTP(S) canonical URL.');
const date = short(40).refine(value => !value || /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)), 'Use an ISO 8601 date with a timezone.');
const structuredData = z.union([z.record(z.string(), z.unknown()), z.array(z.record(z.string(), z.unknown())).max(20)]).nullable().refine(value => {
  try { return Buffer.byteLength(JSON.stringify(value)) <= 65536; } catch { return false; }
}, 'Structured data must be valid JSON smaller than 64 KiB.');

export const pageSeoSchema = z.object({
  title: short(200).optional(), description: short(500).optional(), canonical: canonical.optional(),
  image: image.optional(), imageAlt: short(300).optional(), noindex: z.boolean().optional(),
  type: z.enum(['website', 'article']).optional(), headline: short(200).optional(),
  author: short(150).optional(), publishedTime: date.optional(), modifiedTime: date.optional(),
  structuredData: structuredData.optional(),
}).strict();
export const projectSeoSchema = z.object({
  siteName: short(100).optional(), description: short(500).optional(),
  language: short(35).regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).refine(value => { try { return Intl.getCanonicalLocales(value).length === 1; } catch { return false; } }).optional(),
  image: image.optional(), imageAlt: short(300).optional(), logo: image.optional(),
  favicon: image.optional(), appleTouchIcon: image.optional(), noindex: z.boolean().optional(),
}).strict();

export function validateSeo(value, project = false) {
  const result = (project ? projectSeoSchema : pageSeoSchema).safeParse(value ?? {});
  if (!result.success) throw Object.assign(new Error(`Invalid SEO settings: ${result.error.issues[0].path.join('.')}: ${result.error.issues[0].message}`), { status: 400 });
  return result.data;
}
export function siteBase(project, instance = {}) {
  return project.domain ? `https://${project.domain}/` : `${instance.sitePublicUrl || `http://localhost:${instance.sitePort || 4311}`}/sites/${project.slug}/`;
}
export function pageCanonical(page, project, instance) {
  const prefix = localePrefix(project, pageLocale(page, project));
  const route = prefix && page.slug === prefix.slice(0, -1) ? prefix : page.slug;
  const url = new URL(page.seo?.canonical || route || '', siteBase(project, instance));
  url.hash = '';
  return url.href;
}
export function productionHost(project, hostname) {
  return !!project.domain && !/(?:\.local|\.localhost|\.test|\.invalid)$/.test(project.domain)
    && project.domain.includes('.') && project.domain === String(hostname).toLowerCase();
}
export function pageNoindex(page, project, force = false) {
  return force || page.seo?.noindex === true || project.seo?.noindex === true;
}
const absolute = (value, base) => value ? new URL(value, base).href : '';
export const jsonScript = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

function openGraphLocale(language) {
  const locale = new Intl.Locale(language);
  const region = locale.region || locale.maximize().region;
  return region ? `${locale.language}_${region}` : language.replaceAll('-', '_');
}

export function renderSeo(page, { project = { name: '', slug: '' }, instance = {}, preview = false, noindex = false, alternates = [] } = {}) {
  const seo = page.seo || {}, defaults = project.seo || {};
  const title = seo.title || page.title, description = seo.description || page.description || defaults.description || '';
  const name = defaults.siteName || project.name, language = pageLocale(page, project);
  const direction = languageSettings(project).locales.find(l => l.code === language)?.direction || 'ltr';
  const base = siteBase(project, instance), url = pageCanonical(page, project, instance);
  const imageUrl = absolute(seo.image || defaults.image, base), imageAlt = seo.imageAlt || defaults.imageAlt || title;
  const robots = preview ? 'noindex,nofollow' : pageNoindex(page, project, noindex) ? 'noindex,follow' : 'index,follow,max-image-preview:large';
  const meta = (name, value, property = false) => value ? `<meta ${property ? 'property' : 'name'}="${escapeHtml(name)}" content="${escapeHtml(value)}">` : '';
  const org = { '@type': 'Organization', '@id': `${base}#organization`, name, url: base, ...(defaults.logo ? { logo: { '@type': 'ImageObject', url: absolute(defaults.logo, base) } } : {}) };
  const graph = [org, { '@type': 'WebSite', '@id': `${base}#website`, url: base, name, inLanguage: language, publisher: { '@id': org['@id'] } }];
  const webPage = { '@type': 'WebPage', '@id': `${url}#webpage`, url, name: title, description, inLanguage: language, isPartOf: { '@id': `${base}#website` } };
  if (page.slug) {
    const prefix = localePrefix(project, language), localSlug = prefix ? page.slug.slice(prefix.length).replace(/^\//, '') : page.slug;
    const parts = localSlug ? localSlug.split('/') : [], items = [{ '@type': 'ListItem', position: 1, name: 'Home', item: new URL(prefix, base).href }];
    for (let i = 0; i < parts.length; i++) items.push({ '@type': 'ListItem', position: i + 2, name: i === parts.length - 1 ? seo.headline || title : parts[i].replace(/-/g, ' ').replace(/^./, c => c.toUpperCase()), item: i === parts.length - 1 ? url : new URL(prefix + parts.slice(0, i + 1).join('/'), base).href });
    graph.push({ '@type': 'BreadcrumbList', '@id': `${url}#breadcrumbs`, itemListElement: items });
    webPage.breadcrumb = { '@id': `${url}#breadcrumbs` };
  }
  graph.push(webPage);
  if (seo.type === 'article') graph.push({
    '@type': 'BlogPosting', '@id': `${url}#article`, headline: seo.headline || title, description,
    mainEntityOfPage: { '@id': webPage['@id'] }, inLanguage: language,
    author: { '@type': 'Organization', name: seo.author || name }, publisher: { '@id': org['@id'] },
    ...(imageUrl ? { image: [imageUrl] } : {}),
    ...(seo.publishedTime ? { datePublished: seo.publishedTime } : {}),
    ...(seo.modifiedTime || page.updatedAt ? { dateModified: seo.modifiedTime || page.updatedAt } : {}),
  });
  const custom = seo.structuredData ? (Array.isArray(seo.structuredData) ? seo.structuredData : [seo.structuredData]) : [];
  const head = `<title>${escapeHtml(title)}</title>${meta('description', description)}${meta('robots', robots)}<link rel="canonical" href="${escapeHtml(url)}">`
    + meta('og:title', title, true) + meta('og:description', description, true) + meta('og:type', seo.type === 'article' ? 'article' : 'website', true)
    + meta('og:url', url, true) + meta('og:site_name', name, true) + meta('og:locale', openGraphLocale(language), true)
    + meta('og:image', imageUrl, true) + (imageUrl ? meta('og:image:alt', imageAlt, true) : '')
    + meta('twitter:card', imageUrl ? 'summary_large_image' : 'summary') + meta('twitter:title', title) + meta('twitter:description', description)
    + meta('twitter:image', imageUrl) + (imageUrl ? meta('twitter:image:alt', imageAlt) : '')
    + (seo.type === 'article' ? meta('article:published_time', seo.publishedTime, true) + meta('article:modified_time', seo.modifiedTime || page.updatedAt, true) : '')
    + (defaults.favicon ? `<link rel="icon" href="${escapeHtml(defaults.favicon)}">` : '')
    + (defaults.appleTouchIcon ? `<link rel="apple-touch-icon" href="${escapeHtml(defaults.appleTouchIcon)}">` : '')
    + alternates.map(a => `<link rel="alternate" hreflang="${escapeHtml(a.locale)}" href="${escapeHtml(a.url)}">`).join('')
    + `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(name)} blog" href="${escapeHtml(new URL(localePrefix(project, language) + 'feed.xml', base).href)}">`
    + `<script type="application/ld+json">${jsonScript({ '@context': 'https://schema.org', '@graph': [...graph, ...custom] })}</script>`;
  return { head, language, direction, robots, url };
}

export function publishedPages(state, project) {
  const revisions = new Map(state.revisions.map(r => [r.id, r]));
  return state.pages.filter(p => p.projectId === project.id && p.publishedRevisionId).map(p => revisions.get(p.publishedRevisionId)).filter(Boolean);
}
export function indexablePages(state, project) {
  return publishedPages(state, project).filter(r => !pageNoindex(r.page, project)
    && (() => {
      const actual = pageCanonical(r.page, project, state.instance);
      const expected = pageCanonical({ ...r.page, seo: {} }, project, state.instance);
      const prefix = localePrefix(project, pageLocale(r.page, project));
      // Both routes resolve to a language homepage. Preserve a legacy explicit
      // /sq canonical when adopting languages rather than silently deindexing it.
      return actual === expected || !!prefix && r.page.slug === prefix.slice(0, -1) && `${actual}/` === expected;
    })());
}
export function sitemapXml(state, project) {
  const entries = indexablePages(state, project).sort((a, b) => a.page.slug.localeCompare(b.page.slug));
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${project.languages ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : ''}>${entries.map(r => {
    const prefix = localePrefix(project, pageLocale(r.page, project)).replace(/\/$/, '');
    const local = prefix ? r.page.slug.slice(prefix.length).replace(/^\//, '') : r.page.slug;
    const priority = !local ? '1.0' : r.page.seo?.type === 'article' || local.includes('/') ? '0.6' : '0.8';
    const alternates = pageAlternates(state, project, r.page).map(a => `<xhtml:link rel="alternate" hreflang="${escapeHtml(a.locale)}" href="${escapeHtml(a.url)}"/>`).join('');
    return `<url><loc>${escapeHtml(pageCanonical(r.page, project, state.instance))}</loc><lastmod>${escapeHtml(r.createdAt)}</lastmod><priority>${priority}</priority>${alternates}</url>`;
  }).join('')}</urlset>`;
}
export function pageAlternates(state, project, page) {
  if (!project.languages || pageNoindex(page, project)) return [];
  const variants = translationAlternates(page, project, indexablePages(state, project).map(r => r.page))
    .map(({ locale, page: p }) => ({ locale, url: pageCanonical(p, project, state.instance) }));
  // A draft/noindex/custom-canonical version must not advertise a one-way cluster.
  if (!variants.some(v => v.locale === pageLocale(page, project) && v.url === pageCanonical(page, project, state.instance))) return [];
  const fallback = variants.find(v => v.locale === languageSettings(project).defaultLocale);
  return fallback ? [...variants, { locale: 'x-default', url: fallback.url }] : variants;
}
export function robotsTxt(project, instance, indexable) {
  return indexable && !project.seo?.noindex
    ? `User-agent: *\nAllow: /\nDisallow: /sites/\nAllow: /sites/${project.slug}/\nAllow: /sites/${project.slug}$\nDisallow: /preview/\nDisallow: /admin\nDisallow: /api/\nDisallow: /mcp/\nSitemap: ${new URL('sitemap.xml', siteBase(project, instance)).href}\n`
    : 'User-agent: *\nDisallow: /\n';
}

// Generated from published, indexable, self-canonical pages only. Draft titles,
// private routes and review/noindex documents must never enter this guide.
export function llmsTxt(state, project) {
  const clean = value => String(value || '').replace(/[\r\n\t]+/g, ' ').trim().replace(/[\\`*_[\]<>#]/g, '\\$&');
  const pages = indexablePages(state, project).map(r => r.page);
  const settings = languageSettings(project);
  const homes = new Set(settings.locales.filter(l => l.code !== settings.defaultLocale).map(l => localePrefix(project, l.code).replace(/\/$/, '')));
  const line = page => `- [${clean(page.title)}](${pageCanonical(page, project, state.instance)})${page.description ? `: ${clean(page.description)}` : ''}`;
  const sections = [
    ['Website', pages.filter(p => !p.slug.includes('/') && !homes.has(p.slug)).sort((a, b) => a.slug.localeCompare(b.slug))],
    ['Languages', pages.filter(p => homes.has(p.slug)).sort((a, b) => a.slug.localeCompare(b.slug))],
    ['Articles', pages.filter(p => p.seo?.type === 'article').sort((a, b) => Date.parse(b.seo.publishedTime || b.updatedAt) - Date.parse(a.seo.publishedTime || a.updatedAt)).slice(0, 20)],
  ];
  return `# ${clean(project.seo?.siteName || project.name)}\n\n`
    + (project.seo?.description ? `> ${clean(project.seo.description)}\n\n` : '')
    + 'This guide lists published website content. Follow the linked pages for current details.\n\n'
    + sections.filter(([, items]) => items.length).map(([title, items]) => `## ${title}\n\n${items.map(line).join('\n')}\n`).join('\n');
}
export function feedXml(state, project, locale = languageSettings(project).defaultLocale) {
  const base = siteBase(project, state.instance), name = project.seo?.siteName || project.name;
  const posts = indexablePages(state, project).filter(r => r.page.seo?.type === 'article' && (!project.languages || pageLocale(r.page, project) === locale)).sort((a, b) => Date.parse(b.page.seo.publishedTime || b.createdAt) - Date.parse(a.page.seo.publishedTime || a.createdAt)).slice(0, 100);
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeHtml(name)} blog</title><link>${escapeHtml(new URL(localePrefix(project, locale) + 'blog', base).href)}</link><description>${escapeHtml(project.seo?.description || `Articles from ${name}`)}</description>${posts.map(r => { const p = r.page, url = pageCanonical(p, project, state.instance); return `<item><title>${escapeHtml(p.seo.headline || p.title)}</title><link>${escapeHtml(url)}</link><guid isPermaLink="true">${escapeHtml(url)}</guid><description>${escapeHtml(p.description)}</description><pubDate>${new Date(p.seo.publishedTime || r.createdAt).toUTCString()}</pubDate></item>`; }).join('')}</channel></rss>`;
}
export function renderBlogList(state, project, basePath, currentSlug = '', related = false) {
  const all = publishedPages(state, project), current = all.find(r => r.page.slug === currentSlug)?.page;
  const locale = current ? pageLocale(current, project) : languageSettings(project).locales.find(l => localePrefix(project, l.code) && (currentSlug + '/').startsWith(localePrefix(project, l.code)))?.code || languageSettings(project).defaultLocale;
  const posts = all.filter(r => r.page.seo?.type === 'article' && (!related || r.page.slug !== currentSlug) && (!project.languages || pageLocale(r.page, project) === locale))
    .sort((a, b) => Date.parse(b.page.seo.publishedTime || b.createdAt) - Date.parse(a.page.seo.publishedTime || a.createdAt));
  return posts.slice(0, related ? 3 : 1000).map(({ page: p, createdAt }) => {
    const image = p.seo.image || project.seo?.image;
    const date = p.seo.publishedTime || createdAt;
    return `<a class="blog-card" data-blog-link href="${escapeHtml(`${basePath}${p.slug}`)}"><div class="blog-card-image">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(p.seo.imageAlt || '')}" width="1200" height="900" loading="lazy" decoding="async">` : ''}</div><div class="blog-card-copy"><time datetime="${escapeHtml(date)}">${escapeHtml(new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(date)))}</time><h2>${escapeHtml(p.seo.headline || p.title)}</h2><p>${escapeHtml(p.description)}</p><span class="blog-read">${escapeHtml(languageSettings(project).locales.find(l => l.code === locale)?.readMoreLabel || 'Read the guide')} <span aria-hidden="true">↗</span></span></div></a>`;
  }).join('') || '<p class="blog-empty">New articles are on their way.</p>';
}

export function renderBlogBlocks(html, state, project, basePath, currentSlug = '') {
  if (html.includes('<!-- lumasite:blog-list -->')) html = html.replaceAll('<!-- lumasite:blog-list -->', renderBlogList(state, project, basePath, currentSlug));
  if (html.includes('<!-- lumasite:blog-related -->')) html = html.replaceAll('<!-- lumasite:blog-related -->', renderBlogList(state, project, basePath, currentSlug, true));
  return html;
}
