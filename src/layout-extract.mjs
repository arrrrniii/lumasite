import { randomUUID } from 'node:crypto';
import { parseFragment } from 'parse5';
import { z } from 'zod';
import { compilePageCss } from './compiler.mjs';
import { compileLayout, getLayout, layoutProject, parseLayout } from './layout.mjs';
import { exportProject } from './migration.mjs';
import { projectFingerprint, assertUnchanged, saveProjectBackup, discardProjectBackup, backupSummary } from './project-backups.mjs';
import { escapeHtml } from './templates.mjs';

const selector = z.string().regex(/^(?:[a-z][a-z0-9-]*)?(?:[.#][a-zA-Z_][\w-]*)?$/).refine(s => !!s);
export const extractionSchema = z.object({
  sourcePageId: z.string().uuid(), pageIds: z.array(z.string().uuid()).min(1).max(1000),
  headerSelector: selector.default('header'), footerSelector: selector.default('footer'), additionalHeaderSelector: selector.optional(),
  variantClass: z.string().regex(/^[a-zA-Z_][\w-]*$/).optional(),
  shareCss: z.boolean().default(true), shareJs: z.boolean().default(true),
  dryRun: z.boolean().default(true), expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
function locate(html, selector) {
  const [, tag, kind, value] = selector.match(/^([a-z][a-z0-9-]*)?(?:([.#])([\w-]+))?$/), matches = [];
  function walk(node) {
    if (node.tagName && (!tag || node.tagName === tag) && (!kind || node.attrs?.some(a => kind === '#' ? a.name === 'id' && a.value === value : a.name === 'class' && a.value.split(/\s+/).includes(value)))) matches.push(node);
    for (const child of node.childNodes || []) walk(child);
  }
  walk(parseFragment(html, { sourceCodeLocationInfo: true }));
  if (matches.length !== 1 || !matches[0].sourceCodeLocation?.endTag) fail(`Selector ${selector} must identify exactly one complete element on every page.`);
  return matches[0];
}
function parts(page, options) {
  if (page.layoutMode === 'global') fail('One of the selected pages already uses the global layout.');
  const html = page.html, header = locate(html, options.headerSelector), footer = locate(html, options.footerSelector);
  const extra = options.additionalHeaderSelector ? locate(html, options.additionalHeaderSelector) : null;
  const h = header.sourceCodeLocation, f = footer.sourceCodeLocation, e = extra?.sourceCodeLocation;
  if (h.endOffset > f.startOffset || (e && (e.startOffset < h.endOffset || e.endOffset > f.startOffset || html.slice(h.endOffset, e.startOffset).trim()))) fail('Header, optional adjacent header element, and footer must not overlap.');
  let normalized = html.slice(h.startOffset, h.endOffset), layoutClass = '';
  if (options.variantClass) {
    const attr = header.attrs.find(a => a.name === 'class'), location = h.attrs?.class;
    if (!attr || !location) fail('The header needs a class attribute to support a variant.');
    const classes = attr.value.split(/\s+/).filter(Boolean);
    layoutClass = classes.includes(options.variantClass) ? options.variantClass : '';
    const value = classes.filter(c => c !== options.variantClass).join(' ');
    normalized = normalized.slice(0, location.startOffset - h.startOffset) + `class="${escapeHtml(value)}"` + normalized.slice(location.endOffset - h.startOffset);
  }
  if (e) normalized += html.slice(h.endOffset, e.endOffset);
  const footerHtml = html.slice(f.startOffset, f.endOffset);
  const transformed = html.slice(0, h.startOffset) + '<!-- lumasite:header -->' + html.slice(e?.endOffset ?? h.endOffset, f.startOffset) + '<!-- lumasite:footer -->' + html.slice(f.endOffset);
  return { header: normalized, footer: footerHtml, html: transformed, layoutClass };
}
export async function extractLayout(store, projectId, values) {
  const options = parseLayout(extractionSchema, values), state = store.read(), project = layoutProject(state, projectId);
  if (project.layout) fail('A global layout already exists. Edit it instead of extracting another one.');
  const fingerprint = projectFingerprint(state, projectId);
  if (options.expectedFingerprint && fingerprint !== options.expectedFingerprint) throw Object.assign(new Error('The website changed. Inspect extraction again before applying it.'), { status: 409 });
  const ids = new Set(options.pageIds);
  if (ids.size !== options.pageIds.length || !ids.has(options.sourcePageId)) fail('Select unique page IDs including the source page.');
  const selected = state.pages.filter(p => p.projectId === projectId && ids.has(p.id));
  if (selected.length !== ids.size) fail('Every selected page must belong to this website.');
  const source = selected.find(p => p.id === options.sourcePageId), base = parts(source, options);
  const content = { header: base.header, footer: base.footer, css: options.shareCss ? source.css : '', cssAfter: '', js: options.shareJs ? source.js : '' };
  // Preserve cascade order when page-specific rules were inserted between two
  // common stylesheet sections. Split only at a complete top-level CSS boundary.
  const cssSources = [...selected, ...selected.filter(p => p.publishedRevisionId).map(p => state.revisions.find(r => r.id === p.publishedRevisionId)?.page).filter(Boolean)].map(p => p.css);
  if (content.css && cssSources.some(css => !css.startsWith(content.css))) {
    let prefix = Math.min(...cssSources.map(css => { let i = 0; while (i < Math.min(css.length, source.css.length) && css[i] === source.css[i]) i++; return i; }));
    let depth = 0, quote = '', comment = false, boundary = 0;
    for (let i = 0; i < prefix; i++) {
      const c = source.css[i], next = source.css[i + 1];
      if (comment) { if (c === '*' && next === '/') { comment = false; i++; } continue; }
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
      if (c === '/' && next === '*') { comment = true; i++; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) boundary = i + 1; }
      else if (c === ';' && !depth) boundary = i + 1;
    }
    if (!boundary) fail('Shared CSS differs before a complete rule. Leave CSS per page.');
    content.css = source.css.slice(0, boundary); content.cssAfter = source.css.slice(boundary);
    if (cssSources.some(css => css.length < source.css.length || !css.startsWith(content.css) || !css.endsWith(content.cssAfter))) fail('Shared CSS differs in several sections. Leave CSS per page.');
  }
  if (options.variantClass) {
    const node = locate(content.header, options.headerSelector), location = node.sourceCodeLocation.attrs.class;
    const value = node.attrs.find(a => a.name === 'class').value;
    content.header = content.header.slice(0, location.startOffset) + `class="${escapeHtml(value)} {{page.layoutClass}}"` + content.header.slice(location.endOffset);
  }
  function transform(page) {
    const found = parts(page, options);
    if (found.header !== base.header || found.footer !== base.footer) fail(`Shared markup differs on /${page.slug}. No pages were changed.`);
    if (!page.css.startsWith(content.css) || (content.cssAfter && !page.css.endsWith(content.cssAfter)) || (options.shareJs && page.js !== content.js)) fail(`Shared CSS or JavaScript differs on /${page.slug}. Choose a common source or leave that code per page. Shared JavaScript must match exactly to preserve module scope.`);
    return { ...page, html: found.html, css: page.css.slice(content.css.length, content.cssAfter ? -content.cssAfter.length : undefined), js: page.js.slice(content.js.length), layoutMode: 'global', layoutClass: found.layoutClass };
  }
  const drafts = selected.map(transform), live = selected.filter(p => p.publishedRevisionId).map(p => {
    const revision = state.revisions.find(r => r.id === p.publishedRevisionId);
    if (!revision) fail('Published revision is missing. Restore the website before extraction.');
    return { previous: revision, page: transform(revision.page) };
  });
  const report = { fingerprint, pages: selected.length, publishedPages: live.length, sharedBytes: { header: Buffer.byteLength(content.header), footer: Buffer.byteLength(content.footer), css: Buffer.byteLength(content.css) + Buffer.byteLength(content.cssAfter), js: Buffer.byteLength(content.js) }, preservedDrafts: true };
  if (options.dryRun) return { dryRun: true, ...report };
  if (!options.expectedFingerprint) fail('Inspect with dryRun=true first, then supply its expectedFingerprint to apply extraction.');
  const snapshot = await compileLayout(content, 1), compiled = [];
  for (const item of live) compiled.push({ ...item, compiledCss: await compilePageCss(item.page.html, item.page.css, item.page.js) });
  const backup = await saveProjectBackup(store, project, await exportProject(store, projectId), 'layout');
  try {
    await store.mutate(next => {
      assertUnchanged(next, projectId, fingerprint);
      const p = layoutProject(next, projectId), layout = getLayout(p);
      layout.draft = content; layout.revision = 1; layout.published = snapshot; layout.history = [snapshot]; layout.updatedAt = p.updatedAt = snapshot.createdAt; p.layout = layout;
      for (const draft of drafts) {
        const current = next.pages.find(p => p.id === draft.id);
        Object.assign(current, draft, { revision: current.revision + 1, updatedAt: snapshot.createdAt });
        const published = compiled.find(r => r.page.id === draft.id);
        if (published) {
          const revision = { ...published.previous, id: randomUUID(), number: Math.max(...next.revisions.filter(r => r.pageId === draft.id).map(r => r.number)) + 1, createdAt: snapshot.createdAt, page: published.page, compiledCss: published.compiledCss };
          next.revisions.push(revision); current.publishedRevisionId = revision.id;
        }
      }
      (next.projectBackups ||= []).push(backup);
    });
  } catch (error) { await discardProjectBackup(store, backup); throw error; }
  return { dryRun: false, ...report, backup: backupSummary(backup), publishedLayoutId: snapshot.id };
}
