import { z } from 'zod';
import { parseFragment } from 'parse5';
import { escapeHtml } from './templates.mjs';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const key = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
export const localeCodeSchema = z.string().max(35).regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
  .refine(v => { try { return Intl.getCanonicalLocales(v).length === 1; } catch { return false; } })
  .transform(v => Intl.getCanonicalLocales(v)[0]);
export const translationKeySchema = key;
const languageSchema = z.object({ code: localeCodeSchema, label: z.string().trim().min(1).max(80), direction: z.enum(['ltr', 'rtl']).default('ltr'), readMoreLabel: z.string().trim().min(1).max(100).optional() }).strict();
const settingsContent = z.object({ defaultLocale: localeCodeSchema, locales: z.array(languageSchema).min(1).max(30) }).strict().superRefine((v, ctx) => {
  if (new Set(v.locales.map(l => l.code)).size !== v.locales.length || !v.locales.some(l => l.code === v.defaultLocale)) ctx.addIssue({ code: 'custom', message: 'Languages must be unique and include the default locale.' });
});
export const languageSettingsSchema = settingsContent.safeExtend({ revision: z.number().int().nonnegative(), updatedAt: z.string().datetime().nullable() });
export const languageUpdateSchema = settingsContent.safeExtend({ expectedRevision: z.number().int().nonnegative() });
function parse(schema, value) { const r = schema.safeParse(value); if (!r.success) fail(400, r.error.issues[0].message); return r.data; }
function projectIn(state, id) { const p = state.projects.find(p => p.id === id); if (!p) fail(404, 'Project not found.'); return p; }
export function languageSettings(project = {}) {
  const code = project.seo?.language || 'en';
  return project.languages || { revision: 0, defaultLocale: code, locales: [{ code, label: code, direction: 'ltr' }], updatedAt: null };
}
export const pageLocale = (page, project) => page.locale || languageSettings(project).defaultLocale;
export const localePrefix = (project, locale) => locale === languageSettings(project).defaultLocale ? '' : `${locale.toLowerCase()}/`;
export function localizedPath(project, locale, path = '') {
  locale = parse(localeCodeSchema, locale);
  if (!languageSettings(project).locales.some(l => l.code === locale)) fail(400, 'Enable this language with languages_update first.');
  if (typeof path !== 'string') fail(400, 'Supply a language-relative path.');
  path = path.replace(/^\/+|\/+$/g, '');
  if (path && !/^[a-z0-9]+(?:[/-][a-z0-9]+)*$/.test(path)) fail(400, 'Use lowercase URL paths with letters, numbers, hyphens and slashes.');
  return `${localePrefix(project, locale)}${path}`.replace(/\/$/, '');
}
export function validatePageLanguage(page, project) {
  if (page.locale != null) page.locale = parse(localeCodeSchema, page.locale);
  if (page.translationKey != null) page.translationKey = parse(key, page.translationKey);
  if (!!page.locale !== !!page.translationKey) fail(400, 'Set both locale and translationKey, or clear both with null.');
  const settings = languageSettings(project), locale = pageLocale(page, project);
  if (page.locale && !settings.locales.some(l => l.code === locale)) fail(400, 'Enable this page language first.');
  if (!project.languages) return;
  const prefix = localePrefix(project, locale).replace(/\/$/, '');
  if (prefix && page.slug !== prefix && !page.slug.startsWith(`${prefix}/`)) fail(400, `This language needs the /${prefix}/ URL prefix. Use translation_upsert for automatic paths.`);
  if (!prefix && settings.locales.some(l => l.code !== settings.defaultLocale && (page.slug === l.code.toLowerCase() || page.slug.startsWith(`${l.code.toLowerCase()}/`)))) fail(400, 'A default-language page cannot use another language’s URL prefix.');
}
export function validateTranslationSet(pages, project) {
  const seen = new Set();
  for (const page of pages) {
    validatePageLanguage(page, project);
    if (!page.translationKey) continue;
    const id = `${page.translationKey}:${pageLocale(page, project)}`;
    if (seen.has(id)) fail(409, 'A translation already exists for this page key and language.');
    seen.add(id);
  }
}
export function livePages(state, project) {
  const revisions = new Map(state.revisions.map(r => [r.id, r]));
  return state.pages.filter(p => p.projectId === project.id && p.publishedRevisionId).map(p => revisions.get(p.publishedRevisionId)?.page).filter(Boolean);
}
export function languagesSummary(state, id) {
  const project = projectIn(state, id), settings = languageSettings(project);
  return { languages: settings, enabled: !!project.languages, pages: state.pages.filter(p => p.projectId === id).map(p => ({ id: p.id, title: p.title, slug: p.slug, locale: pageLocale(p, project), translationKey: p.translationKey || null, revision: p.revision, published: !!p.publishedRevisionId })), prefixes: Object.fromEntries(settings.locales.map(l => [l.code, `/${localePrefix(project, l.code)}`])) };
}
export async function updateLanguages(store, id, input) {
  const { expectedRevision, ...values } = parse(languageUpdateSchema, input);
  await store.mutate(state => {
    const project = projectIn(state, id);
    if (languageSettings(project).revision !== expectedRevision) fail(409, 'Languages changed. Read languages_get before saving.');
    const next = { ...project, languages: { ...values, revision: expectedRevision + 1, updatedAt: new Date().toISOString() } };
    validateTranslationSet(state.pages.filter(p => p.projectId === id), next);
    validateTranslationSet(livePages(state, project), next);
    for (const menu of [...(project.navigation?.draft || []), ...(project.navigation?.published?.menus || [])]) if (!values.locales.some(l => l.code === menu.locale)) fail(409, 'Remove this language’s draft and published menus before removing the language.');
    project.languages = next.languages; project.seo = { ...project.seo, language: values.defaultLocale }; project.updatedAt = next.languages.updatedAt;
  });
  return languagesSummary(store.read(), id);
}
const safeHref = value => {
  if (/[\\\u0000-\u0020\u007f<>]/.test(value)) return false;
  if (/^(?:\/(?!\/)|#)/.test(value)) return true;
  try { const u = new URL(value); return ['https:', 'http:', 'mailto:', 'tel:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; }
};
const menuItemSchema = z.lazy(() => z.object({ label: z.string().trim().min(1).max(150), translationKey: key.optional(), href: z.string().min(1).max(2048).refine(safeHref, 'Use a root-relative URL, fragment, HTTP(S), mailto or tel link.').optional(), children: z.array(menuItemSchema).max(30).optional() }).strict().refine(v => !!v.translationKey !== !!v.href, 'Each menu item needs either a translationKey or href.'));
const depth = (items, level = 1) => level <= 3 && items.every(i => !i.children?.length || depth(i.children, level + 1));
export const menuSchema = z.object({ key, locale: localeCodeSchema, label: z.string().trim().min(1).max(150), items: z.array(menuItemSchema).max(100).refine(v => depth(v), 'Menu nesting is limited to three levels.') }).strict();
export const menuUpsertSchema = menuSchema.extend({ expectedRevision: z.number().int().nonnegative() });
export const menuRemoveSchema = z.object({ key, locale: localeCodeSchema, expectedRevision: z.number().int().nonnegative() }).strict();
export const navigationSchema = z.object({ revision: z.number().int().nonnegative(), draft: z.array(menuSchema).max(150), published: z.object({ revision: z.number().int().nonnegative(), menus: z.array(menuSchema).max(150), publishedAt: z.string().datetime() }).strict().nullable() }).strict();
export function getMenus(project) { return project.navigation || { revision: 0, draft: [], published: null }; }
export async function editMenu(store, id, input, remove = false) {
  const { expectedRevision, ...menu } = parse(remove ? menuRemoveSchema : menuUpsertSchema, input);
  return store.mutate(state => {
    const project = projectIn(state, id), navigation = structuredClone(getMenus(project));
    if (navigation.revision !== expectedRevision) fail(409, 'Menus changed. Read menus_get before saving.');
    if (!languageSettings(project).locales.some(l => l.code === menu.locale)) fail(400, 'Enable this menu language first.');
    navigation.draft = navigation.draft.filter(m => m.key !== menu.key || m.locale !== menu.locale);
    if (!remove) navigation.draft.push(menu);
    navigation.revision++; project.navigation = parse(navigationSchema, navigation); project.updatedAt = new Date().toISOString();
    return { navigation: project.navigation };
  });
}
export async function publishMenus(store, id, { expectedRevision }) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) fail(400, 'Supply expectedRevision from menus_get.');
  return store.mutate(state => {
    const project = projectIn(state, id), navigation = structuredClone(getMenus(project));
    if (navigation.revision !== expectedRevision) fail(409, 'Menus changed. Read menus_get before publishing.');
    navigation.published = { revision: navigation.revision, menus: structuredClone(navigation.draft), publishedAt: new Date().toISOString() };
    project.navigation = navigation; project.updatedAt = navigation.published.publishedAt;
    return { navigation };
  });
}
export function translationAlternates(page, project, pages) {
  if (!page.translationKey) return [];
  return languageSettings(project).locales.flatMap(l => {
    const p = pages.find(p => p.translationKey === page.translationKey && pageLocale(p, project) === l.code);
    return p ? [{ locale: l.code, page: p }] : [];
  });
}
export function renderLocalizedNavigation(html, state, project, page, { basePath = '/', preview = false } = {}) {
  if (!project.languages && !project.navigation) return html;
  const locale = pageLocale(page, project), settings = languageSettings(project), pages = livePages(state, project);
  // Draft previews may render their own translation, but never other private drafts.
  if (preview) { const at = pages.findIndex(p => p.id === page.id); if (at >= 0) pages.splice(at, 1); pages.push(page); }
  const url = p => `${basePath}${p.slug}${p.slug && p.slug === localePrefix(project, pageLocale(p, project)).replace(/\/$/, '') ? '/' : ''}`;
  function localLink(value) {
    if (!/^(?:\/(?!\/)|https?:\/\/)/i.test(value) || /[\\\u0000-\u0020\u007f]/.test(value)) return value;
    let link; try { link = new URL(value, project.domain ? `https://${project.domain}` : state.instance.sitePublicUrl); } catch { return value; }
    const origins = new Set([state.instance.sitePublicUrl, `https://${project.domain}`, `http://${project.domain}`]);
    if (!origins.has(link.origin) || link.username || link.password) return value;
    let slug = link.pathname.replace(/^\/+|\/+$/g, '');
    if (slug === `sites/${project.slug}`) slug = '';
    else if (slug.startsWith(`sites/${project.slug}/`)) slug = slug.slice(`sites/${project.slug}/`.length);
    const source = pages.find(p => p.slug === slug);
    const target = source?.translationKey && pages.find(p => p.translationKey === source.translationKey && pageLocale(p, project) === locale);
    return target ? url(target) + link.search + link.hash : value;
  }
  const menus = preview ? getMenus(project).draft : getMenus(project).published?.menus || [];
  const itemsHtml = items => items.flatMap(item => {
    const target = item.translationKey && pages.find(p => p.translationKey === item.translationKey && pageLocale(p, project) === locale);
    if (item.translationKey && !target) return [];
    const href = target ? url(target) : localLink(item.href);
    return [`<li><a href="${escapeHtml(href)}"${target?.id === page.id ? ' aria-current="page"' : ''}>${escapeHtml(item.label)}</a>${item.children?.length ? `<ul>${itemsHtml(item.children)}</ul>` : ''}</li>`];
  }).join('');
  const switcher = () => `<nav class="ls-languages" aria-label="Languages">${translationAlternates(page, project, pages).map(({ locale: code, page: p }) => `<a data-ls-language="${escapeHtml(code)}" href="${escapeHtml(url(p))}" hreflang="${escapeHtml(code)}" lang="${escapeHtml(code)}"${code === locale ? ' aria-current="page"' : ''}>${escapeHtml(settings.locales.find(l => l.code === code).label)}</a>`).join('')}</nav>`;
  const tree = parseFragment(html, { sourceCodeLocationInfo: true, scriptingEnabled: false }), edits = [], nodes = [tree];
  while (nodes.length) {
    const node = nodes.pop();
    if (['script', 'style', 'template'].includes(node.tagName)) continue;
    nodes.push(...node.childNodes || []);
    if (node.nodeName === '#comment' && node.sourceCodeLocation) {
      const match = node.data.trim().match(/^lumasite:menu:([a-z0-9.-]+)$/);
      let replacement;
      if (node.data.trim() === 'lumasite:languages') replacement = page.translationKey ? switcher() : '';
      if (match) { const menu = menus.find(m => m.key === match[1] && m.locale === locale); replacement = menu ? `<nav class="ls-menu ls-menu-${escapeHtml(menu.key)}" aria-label="${escapeHtml(menu.label)}"><ul>${itemsHtml(menu.items)}</ul></nav>` : ''; }
      if (replacement !== undefined) edits.push({ ...node.sourceCodeLocation, replacement });
    }
    if (!['a', 'area'].includes(node.tagName) || node.attrs?.some(a => a.name === 'data-ls-language')) continue;
    const attr = node.attrs?.find(a => a.name === 'href'), location = node.sourceCodeLocation?.attrs?.href;
    if (!attr || !location || !/^(?:\/(?!\/)|https?:\/\/)/i.test(attr.value) || /[\\\u0000-\u0020\u007f]/.test(attr.value)) continue;
    const href = localLink(attr.value);
    if (href !== attr.value) edits.push({ ...location, replacement: `href="${escapeHtml(href)}"` });
  }
  for (const edit of edits.sort((a, b) => b.startOffset - a.startOffset)) html = html.slice(0, edit.startOffset) + edit.replacement + html.slice(edit.endOffset);
  return html;
}
