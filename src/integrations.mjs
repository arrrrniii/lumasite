import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseFragment } from 'parse5';
import { escapeHtml } from './templates.mjs';
import { jsonScript } from './seo.mjs';

function verificationToken(value) {
  if (typeof value !== 'string' || !value.trim().startsWith('<')) return value;
  const nodes = parseFragment(value.trim()).childNodes;
  const meta = nodes.length === 1 && nodes[0].tagName === 'meta' ? nodes[0] : null;
  if (meta?.attrs.find(a => a.name === 'name')?.value === 'google-site-verification') return meta.attrs.find(a => a.name === 'content')?.value ?? value;
  return value;
}
const code = z.string().max(65536).refine(s => Buffer.byteLength(s) <= 65536, 'Each snippet must be at most 64 KiB.')
  .refine(s => !/\bls_(?:admin|project|oauth|refresh|code)_[A-Za-z0-9_-]{40,}\b/.test(s), 'Do not put private LumaSite credentials in public website code.');
export const customTagSchema = z.object({
  id: z.string().uuid().default(() => randomUUID()), name: z.string().trim().min(1).max(100),
  placement: z.enum(['head', 'bodyStart', 'bodyEnd']).default('head'), code,
  enabled: z.boolean().default(true), requiresConsent: z.boolean().default(true),
}).strict();
const settingsObject = z.object({
  googleAnalyticsId: z.string().trim().regex(/^(?:G-[A-Z0-9]{4,30})?$/, 'Use a GA4 measurement ID such as G-ABC1234567.').default(''),
  googleTagManagerId: z.string().trim().regex(/^(?:GTM-[A-Z0-9]{4,30})?$/, 'Use a container ID such as GTM-ABC1234.').default(''),
  googleSiteVerification: z.preprocess(verificationToken, z.string().trim().max(512).regex(/^[A-Za-z0-9_-]*$/, 'Paste the Google verification token or its complete meta tag.')).default(''),
  trackingEnabled: z.boolean().default(false), consentMode: z.enum(['banner', 'immediate']).default('banner'),
  customTags: z.array(customTagSchema).max(30).default([]),
  revision: z.number().int().nonnegative().default(0), updatedAt: z.string().datetime().nullable().default(null),
}).strict();
export const integrationSettingsSchema = settingsObject.refine(v => v.customTags.reduce((sum, t) => sum + Buffer.byteLength(t.code), 0) <= 256 * 1024, 'Combined snippets must be at most 256 KiB.')
  .refine(v => new Set(v.customTags.map(t => t.id)).size === v.customTags.length, 'Snippet IDs must be unique.');
export const integrationPatchSchema = z.object(Object.fromEntries(Object.entries(settingsObject.shape)
  .filter(([key]) => !['revision', 'updatedAt'].includes(key)).map(([key, schema]) => [key, schema.removeDefault().optional()])))
  .extend({
    googleSiteVerification: z.string().trim().max(2048).optional(),
    customTags: z.array(customTagSchema.extend({ id: z.string().uuid().optional() })).max(30).optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
  }).strict();

export function validateIntegrations(value, patch = false) {
  const result = (patch ? integrationPatchSchema : integrationSettingsSchema).safeParse(value ?? {});
  if (!result.success) throw Object.assign(new Error(result.error.issues[0].message), { status: 400 });
  return result.data;
}
export const getIntegrations = project => validateIntegrations(project.integrations);

export async function updateIntegrations(store, projectId, values) {
  const patch = validateIntegrations(values, true);
  return store.mutate(state => {
    const project = state.projects.find(p => p.id === projectId);
    if (!project) throw Object.assign(new Error('Project not found.'), { status: 404 });
    const current = getIntegrations(project);
    if (patch.expectedRevision !== undefined && patch.expectedRevision !== current.revision) throw Object.assign(new Error('Integrations changed in another session. Reload before saving.'), { status: 409 });
    const { expectedRevision, ...settings } = patch;
    const now = new Date().toISOString();
    project.integrations = validateIntegrations({ ...current, ...settings, revision: current.revision + 1, updatedAt: now });
    project.updatedAt = now;
    return { integrations: project.integrations };
  });
}

export function integrationMarkup(project, production = false) {
  const empty = { head: '', bodyStart: '', bodyEnd: '' };
  if (!production || !project?.integrations) return empty;
  const settings = getIntegrations(project), result = { ...empty }, optional = [];
  if (settings.googleSiteVerification) result.head += `<meta name="google-site-verification" content="${escapeHtml(settings.googleSiteVerification)}">`;
  function add(code, placement, requiresConsent) {
    if (requiresConsent && settings.consentMode === 'banner') optional.push({ code, placement });
    else result[placement] += code;
  }
  // Essential custom head code runs before Google tags, allowing a site's own
  // consent manager to establish defaults when immediate loading is selected.
  for (const tag of settings.customTags.filter(t => t.enabled && !t.requiresConsent)) add(tag.code, tag.placement, false);
  if (settings.trackingEnabled && settings.googleAnalyticsId) {
    const id = settings.googleAnalyticsId;
    add(`<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');</script>`, 'head', true);
  }
  if (settings.trackingEnabled && settings.googleTagManagerId) {
    const id = settings.googleTagManagerId;
    add(`<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');</script>`, 'head', true);
    if (settings.consentMode === 'immediate') result.bodyStart = `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${id}" height="0" width="0" style="display:none;visibility:hidden" title="Google Tag Manager"></iframe></noscript>` + result.bodyStart;
  }
  for (const tag of settings.customTags.filter(t => t.enabled && t.requiresConsent)) add(tag.code, tag.placement, true);
  if (optional.length) result.head += `<script type="application/json" id="lumasite-optional-tags">${jsonScript({ projectId: project.id, tags: optional })}</script><script defer src="/runtime/integrations.js"></script>`;
  return result;
}
