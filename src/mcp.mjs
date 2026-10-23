import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { layoutSummary, updateLayout, publishLayout, restoreLayout, layoutPatchSchema, layoutModeSchema, layoutClassSchema } from './layout.mjs';
import { extractLayout, extractionSchema } from './layout-extract.mjs';
import { pageSeoSchema, projectSeoSchema } from './seo.mjs';
import { getIntegrations, updateIntegrations, integrationPatchSchema } from './integrations.mjs';
import { VERSION, requireProject, requirePage, publicProject, getProjectUrls, updateProject, createPage, updatePage, publishPage, restorePage, uploadAsset, getLibrary, getPreviewUrl } from './service.mjs';

export async function handleMcp(req, res, store, projectId) {
  const server = new McpServer({ name: 'LumaSite', version: VERSION }, { instructions: 'Edit native HTML/CSS/browser JavaScript in this authorized project. Read pages and revision before updating. A save changes the draft; call page_publish to update the live page. Use layout_get/update/publish for shared header/footer/CSS/JS; read layout_get before editing a page and avoid copying shared markup into linked pages. Global page HTML can use <!-- lumasite:header --> and <!-- lumasite:footer --> slots. LumaFX data-fx attributes are available natively; inspect library_list. Never put access tokens or admin credentials in website code.' });
  function register(name, description, inputSchema, fn, readOnlyHint = false) {
    server.registerTool(name, { description, inputSchema, _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['website:manage'] }] }, annotations: { readOnlyHint, destructiveHint: false, idempotentHint: readOnlyHint, openWorldHint: false } }, async args => {
      try {
        requireProject(store.read(), projectId);
        const data = await fn(args);
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
      } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
    });
  }
  const pageId = z.string().uuid(), source = z.string().max(1024 * 1024);
  register('project_get', 'Read project settings, branding and generated URLs.', {}, () => { const state = store.read(), project = publicProject(requireProject(state, projectId)); return { project, urls: getProjectUrls(state, project) }; }, true);
  register('project_update', 'Update name, domain, CSS-variable theme or shared SEO/branding defaults. SEO defaults apply immediately; republish pages to release changed theme.', { name: z.string().optional(), domain: z.string().optional(), theme: z.record(z.string(), z.string()).optional(), seo: projectSeoSchema.optional() }, args => updateProject(store, projectId, args));
  register('layout_get', 'Read the shared layout draft, published version, history and page assignments. Global header/footer/CSS/JS are edited once for every linked page.', {}, () => layoutSummary(store.read(), projectId), true);
  register('layout_update', 'Save shared header/footer/CSS/JS as a draft; omitted fields stay unchanged. Use expectedRevision from layout_get. Draft preview includes this layout; live pages remain unchanged until layout_publish. Optional HTML bindings: {{page.title}}, {{page.slug}}, {{page.layoutClass}}.', layoutPatchSchema.shape, args => updateLayout(store, projectId, args));
  register('layout_publish', 'Publish the saved global layout atomically to all linked published pages without republishing page bodies. Pass expectedRevision from layout_get.', { expectedRevision: z.number().int().nonnegative().optional() }, args => publishLayout(store, projectId, args));
  register('layout_restore', 'Restore one of the last 50 published layout versions into a draft. Preview and publish separately.', { snapshotId: z.string().uuid(), expectedRevision: z.number().int().nonnegative().optional() }, args => restoreLayout(store, projectId, args));
  register('layout_extract', 'Move matching existing header/footer and common CSS/JS into a published global layout. Read-only dryRun=true is required first; then pass its expectedFingerprint with dryRun=false. This creates a recovery ZIP and links selected draft/live pages atomically, preserving unpublished body edits and page-specific CSS/JS. Selectors support tag, .class, #id, tag.class or tag#id. Refuses differing shared markup/code and existing layouts.', extractionSchema.shape, args => extractLayout(store, projectId, args));
  register('integrations_get', 'Read website-wide GA4, Google Tag Manager, Search Console verification, consent mode and custom HTML/script snippets. These settings only run on the production domain, never on previews or Studio.', {}, () => ({ integrations: getIntegrations(requireProject(store.read(), projectId)) }), true);
  register('integrations_update', 'Update shared integrations without editing or republishing pages. Read integrations_get first and pass expectedRevision. Omitted fields are preserved; customTags replaces the full list. Google tracking needs trackingEnabled=true. Consent banner is the default for optional tags. Public snippets must never contain private credentials. This adds installation code, not Google account/report access or completed ownership verification.', integrationPatchSchema.shape, args => updateIntegrations(store, projectId, args));
  register('pages_list', 'List pages, IDs, paths and draft/published revision information.', {}, () => ({ pages: store.read().pages.filter(p => p.projectId === projectId).map(({ html, css, js, ...metadata }) => metadata) }), true);
  register('page_get', 'Read full editable HTML, CSS, JavaScript and current revision.', { pageId }, args => ({ page: requirePage(store.read(), projectId, args.pageId) }), true);
  register('page_upsert', 'Create or update a page draft, including SEO, social image and JSON-LD. Use nested slug blog/article-name and seo.type=article for blog posts; published articles populate blog-list markers, sitemap and RSS automatically. Supply pageId and latest revision to update; publish separately.', { pageId: pageId.optional(), title: z.string().optional(), slug: z.string().optional(), description: z.string().optional(), html: source.optional(), css: source.optional(), js: source.optional(), seo: pageSeoSchema.optional(), layoutMode: layoutModeSchema.optional(), layoutClass: layoutClassSchema.optional(), revision: z.number().int().optional() }, async ({ pageId: id, ...data }) => ({ page: id ? await updatePage(store, projectId, id, data) : await createPage(store, projectId, data) }));
  register('page_publish', 'Publish the saved draft atomically, generating Tailwind CSS. Does not restart or rebuild the platform.', { pageId }, args => publishPage(store, projectId, args.pageId));
  register('page_restore', 'Restore a prior published revision into a draft; publish separately to update the live site.', { pageId, revisionId: z.string().uuid() }, async args => ({ page: await restorePage(store, projectId, args.pageId, args.revisionId) }));
  register('assets_list', 'List this project images, audio, video and font assets.', {}, () => ({ assets: store.read().assets.filter(a => a.projectId === projectId) }), true);
  register('asset_upload', 'Upload a project media file as base64, maximum decoded size 50 MB. Use returned root-relative url in page source.', { name: z.string(), mime: z.string(), base64: z.string().max(70 * 1024 * 1024) }, async args => ({ asset: await uploadAsset(store, projectId, { name: args.name, mime: args.mime, data: args.base64 }) }));
  register('library_list', 'Read native component snippets and the real self-hosted LumaFX animation recipes. Effects are applied using data-fx HTML attributes.', {}, () => getLibrary(), true);
  register('preview_url', 'Create a signed draft preview URL valid for ten minutes on the separate public origin.', { pageId }, args => ({ url: getPreviewUrl(store.read(), projectId, args.pageId) }), true);
  register('health', 'Read instance health and running ports.', {}, () => { const instance = store.read().instance; return { status: 'ok', version: VERSION, port: instance.port, sitePort: instance.sitePort, uptime: process.uptime() }; }, true);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
