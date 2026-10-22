import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { VERSION, requireProject, requirePage, publicProject, getProjectUrls, updateProject, createPage, updatePage, publishPage, restorePage, uploadAsset, getLibrary, getPreviewUrl } from './service.mjs';

export async function handleMcp(req, res, store, projectId) {
  const server = new McpServer({ name: 'LumaSite', version: VERSION }, { instructions: 'Edit native HTML/CSS/browser JavaScript in this authorized project. Read pages and revision before updating. A save changes the draft; call page_publish to update the live page. LumaFX data-fx attributes are available natively; inspect library_list. Never put access tokens or admin credentials in website code.' });
  function register(name, description, inputSchema, fn, readOnlyHint = false) {
    server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint, destructiveHint: false, idempotentHint: readOnlyHint, openWorldHint: false } }, async args => {
      try {
        requireProject(store.read(), projectId);
        const data = await fn(args);
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
      } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
    });
  }
  const pageId = z.string().uuid(), source = z.string().max(1024 * 1024);
  register('project_get', 'Read project settings, branding and generated URLs.', {}, () => { const state = store.read(), project = publicProject(requireProject(state, projectId)); return { project, urls: getProjectUrls(state, project) }; }, true);
  register('project_update', 'Update this project name, domain or CSS-variable theme. Republish pages to release changed theme.', { name: z.string().optional(), domain: z.string().optional(), theme: z.record(z.string(), z.string()).optional() }, args => updateProject(store, projectId, args));
  register('pages_list', 'List pages, IDs, paths and draft/published revision information.', {}, () => ({ pages: store.read().pages.filter(p => p.projectId === projectId).map(({ html, css, js, ...metadata }) => metadata) }), true);
  register('page_get', 'Read full editable HTML, CSS, JavaScript and current revision.', { pageId }, args => ({ page: requirePage(store.read(), projectId, args.pageId) }), true);
  register('page_upsert', 'Create a native page or update a draft. Supply pageId for updates and revision for conflict detection. Full visual layouts, styles and browser JavaScript are editable; no platform rebuild.', { pageId: pageId.optional(), title: z.string().optional(), slug: z.string().optional(), description: z.string().optional(), html: source.optional(), css: source.optional(), js: source.optional(), revision: z.number().int().optional() }, async ({ pageId: id, ...data }) => ({ page: id ? await updatePage(store, projectId, id, data) : await createPage(store, projectId, data) }));
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
