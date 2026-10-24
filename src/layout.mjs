import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { compilePageCss } from './compiler.mjs';
import { pageLocale } from './i18n.mjs';
import { escapeHtml } from './templates.mjs';

const source = z.string().refine(s => Buffer.byteLength(s) <= 1024 * 1024, 'Layout fields must be at most 1 MiB.')
  .refine(s => !/\bls_(?:admin|project|oauth|refresh|code)_[A-Za-z0-9_-]{40,}\b/.test(s), 'Never put private credentials in website code.');
export const layoutContentSchema = z.object({ header: source, footer: source, locales: z.record(z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/), z.object({ header: source.optional(), footer: source.optional() }).strict()).refine(v => Object.keys(v).length <= 30).optional(), css: source, cssAfter: source.optional(), js: source }).strict();
export const layoutPatchSchema = layoutContentSchema.partial().extend({ expectedRevision: z.number().int().nonnegative().optional() }).strict();
const snapshotSchema = layoutContentSchema.extend({ id: z.string().uuid(), revision: z.number().int().nonnegative(), createdAt: z.string().datetime(), compiledCss: z.string().refine(s => Buffer.byteLength(s) <= 8 * 1024 * 1024) }).strict();
export const layoutSchema = z.object({ revision: z.number().int().nonnegative(), draft: layoutContentSchema, published: snapshotSchema.nullable(), history: z.array(snapshotSchema).max(50), updatedAt: z.string().datetime().nullable() }).strict();
export const layoutModeSchema = z.enum(['none', 'global']);
export const layoutClassSchema = z.string().max(200).regex(/^[a-zA-Z0-9_ -]*$/);
export const emptyLayout = () => ({ revision: 0, draft: { header: '', footer: '', css: '', cssAfter: '', js: '' }, published: null, history: [], updatedAt: null });
export function layoutProject(state, projectId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) throw Object.assign(new Error('Project not found.'), { status: 404 });
  return project;
}
export function parseLayout(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw Object.assign(new Error(result.error.issues[0].message), { status: 400 });
  return result.data;
}
export function getLayout(project) { return project.layout ? structuredClone(project.layout) : emptyLayout(); }
const conflict = () => { throw Object.assign(new Error('The layout changed. Reload before saving or publishing.'), { status: 409 }); };
export function layoutSummary(state, projectId) {
  const layout = getLayout(layoutProject(state, projectId));
  const published = layout.published && Object.fromEntries(Object.entries(layout.published).filter(([key]) => key !== 'compiledCss'));
  return { layout: { ...layout, published, history: layout.history.map(({ id, revision, createdAt }) => ({ id, revision, createdAt })) }, pages: state.pages.filter(p => p.projectId === projectId).map(p => ({ id: p.id, title: p.title, slug: p.slug, layoutMode: p.layoutMode || 'none', layoutClass: p.layoutClass || '', published: !!p.publishedRevisionId })) };
}
export async function updateLayout(store, projectId, values) {
  const { expectedRevision, ...patch } = parseLayout(layoutPatchSchema, values);
  await store.mutate(state => {
    const project = layoutProject(state, projectId), layout = getLayout(project);
    if (expectedRevision !== undefined && layout.revision !== expectedRevision) conflict();
    layout.draft = parseLayout(layoutContentSchema, { ...layout.draft, ...patch });
    layout.revision++; layout.updatedAt = project.updatedAt = new Date().toISOString(); project.layout = layout;
  });
  return layoutSummary(store.read(), projectId);
}
export async function compileLayout(content, revision) {
  return { ...content, id: randomUUID(), revision, createdAt: new Date().toISOString(), compiledCss: await compilePageCss(content.header + content.footer + Object.values(content.locales || {}).map(l => (l.header || '') + (l.footer || '')).join(''), content.css, content.js) };
}
export async function publishLayout(store, projectId, { expectedRevision } = {}) {
  const layout = getLayout(layoutProject(store.read(), projectId));
  if (expectedRevision !== undefined && layout.revision !== expectedRevision) conflict();
  if (layout.published?.revision === layout.revision) return layoutSummary(store.read(), projectId);
  const snapshot = await compileLayout(layout.draft, layout.revision);
  await store.mutate(state => {
    const project = layoutProject(state, projectId), current = getLayout(project);
    if (current.revision !== layout.revision) conflict();
    if (current.published?.revision === layout.revision) return;
    current.published = snapshot; current.history = [...current.history, snapshot].slice(-50);
    current.updatedAt = project.updatedAt = snapshot.createdAt; project.layout = current;
  });
  return layoutSummary(store.read(), projectId);
}
export async function restoreLayout(store, projectId, { snapshotId, expectedRevision } = {}) {
  await store.mutate(state => {
    const project = layoutProject(state, projectId), layout = getLayout(project);
    if (expectedRevision !== undefined && layout.revision !== expectedRevision) conflict();
    const previous = layout.history.find(r => r.id === snapshotId);
    if (!previous) throw Object.assign(new Error('Layout version not found.'), { status: 404 });
    layout.draft = Object.fromEntries(['header', 'footer', 'locales', 'css', 'cssAfter', 'js'].map(key => [key, previous[key]]));
    layout.revision++; layout.updatedAt = project.updatedAt = new Date().toISOString(); project.layout = layout;
  });
  return layoutSummary(store.read(), projectId);
}
export function composeLayout(html, page, content, project) {
  if (page.layoutMode !== 'global' || !content) return html;
  const bind = value => value.replace(/\{\{page\.(title|slug|layoutClass|locale)\}\}/g, (_, key) => escapeHtml(key === 'locale' ? pageLocale(page, project) : page[key] || ''));
  const localized = content.locales?.[pageLocale(page, project)] || {};
  const header = bind(localized.header ?? content.header), footer = bind(localized.footer ?? content.footer);
  const h = '<!-- lumasite:header -->', f = '<!-- lumasite:footer -->';
  const count = marker => html.split(marker).length - 1;
  if (!count(h) && !count(f)) return header + html + footer;
  if (count(h) !== 1 || count(f) !== 1 || html.indexOf(h) > html.indexOf(f)) throw Object.assign(new Error('Use exactly one header and one footer slot, in that order.'), { status: 400 });
  return html.replace(h, () => header).replace(f, () => footer);
}
export function pageLayout(project, page, preview = false) {
  if (page.layoutMode !== 'global') return null;
  return preview ? getLayout(project).draft : project.layout?.published || null;
}
