# LumaSite first local release

Independent Node 24 ESM product; do not change the parent email platform. Native HTML/CSS/browser JavaScript, per-page Tailwind generation on publish, self-hosted LumaFX, image/audio/video storage, drafts and immutable published revisions. A running instance has separate admin/API/MCP and public-site listeners (defaults 4310/4311).

## Shared interfaces (agents implement their own files only)

Root owns `package.json`, `src/store.mjs`, `src/service.mjs`, `src/server.mjs`, `src/mcp.mjs`, `src/compiler.mjs`, integration tests and runtime assets.
CLI agent owns `bin/lumasite.mjs`, `src/cli.mjs`, `src/proxy.mjs`, `Dockerfile`, `compose.yaml`, `.dockerignore`, CLI tests, `README.md` and docs.
Admin agent owns `public/admin.html`, `public/admin.css`, `public/admin.js` and UI-only assets. No React/build needed.
Research agent owns `docs/sitewright-comparison.md`, `docs/lumafx-integration.md` and vendored LumaFX files under `vendor/lumafx/`.

## Store API

`openStore(dataDir)` async returns `{ read(), mutate(fn), dataDir }`. `read()` returns a structured clone. `mutate(fn)` serializes updates, calls fn(state), writes atomically, returns fn result. Initial `{version:1, instance:null, projects:[], pages:[], revisions:[], assets:[]}`.

`initializeInstance(store, {port=4310, sitePort=4311, host='127.0.0.1', publicUrl, password})` from `src/service.mjs`: initializes once and writes private `credentials.json` (mode 0600). Returns `{instance, password, adminToken}`. Existing calls reject. Default random password. Instance has id, host, port, sitePort, publicUrl, createdAt, passwordHash, adminTokenHash. Public URL defaults http://localhost:<port>.

`createProject(store,{name,domain,slug})` returns `{project, token, urls}` and also saves project token in private credentials. `getProjectUrls(state, project)` returns `{admin, mcp, site, production}`. IDs UUID. Projects fields id,name,slug,domain,createdAt,updatedAt,tokenHash,theme. Generated admin `/admin/projects/<id>`, MCP `/mcp/<id>`. Public local site `/sites/<projectSlug>/` on sitePort. `createPage(store,projectId, data)` / `updatePage(store,projectId,pageId,data)` return page. Pages fields id,projectId,slug (root empty string),title,description,html,css,js,updatedAt,revision,publishedRevisionId. Default createProject seeds a polished home page. All service validation throws `{status,message}`.

## HTTP API

JSON `{error:message}` errors. `GET /api/setup` -> `{configured,version,port,sitePort}`. `POST /api/setup` -> initialize with `{password,port?,sitePort?,publicUrl?}`, set admin session, return `{instance,adminToken}`. `POST /api/login` `{password}` sets HttpOnly session; `POST /api/logout`; `GET /api/session` -> `{authenticated:true}`. Bearer adminToken also authorizes APIs.

`GET /api/projects` -> `{projects:[{...project,urls}]}` (secret hashes excluded).
`POST /api/projects` `{name,domain,slug?}` -> `{project,token,urls}`.
`GET /api/projects/:id` -> `{project,urls}`.
`PATCH /api/projects/:id` `{name?,domain?,theme?}` -> `{project,urls}`.
`GET /api/projects/:id/pages` -> `{pages}`.
`POST /api/projects/:id/pages` `{title,slug,html?,css?,js?,description?}` -> `{page}`.
`GET /api/projects/:id/pages/:pageId` -> `{page}`.
`PUT /api/projects/:id/pages/:pageId` partial -> `{page}`.
`POST /api/projects/:id/pages/:pageId/publish` -> `{page,revision,url}`.
`GET /api/projects/:id/pages/:pageId/revisions` -> `{revisions}`.
`POST /api/projects/:id/pages/:pageId/restore` `{revisionId}` -> `{page}` restores draft, requires publish to replace live.
`POST /api/projects/:id/preview` `{pageId}` -> `{url}` signed short-lived URL on separate public listener; draft iframe sandbox allow-scripts only.
`GET /api/projects/:id/assets` -> `{assets}`.
`POST /api/projects/:id/assets` raw file body; `X-Filename: encodeURIComponent(name)`; Content-Type actual file MIME -> `{asset}` with `.url`.
`POST /api/projects/:id/token` -> `{token}` rotate project token.
`GET /api/library` -> `{components:[{id,name,description,html,css?,js?}],animations:[{id,name,description,html?,css?,js?,category?}]}`.
`GET /api/diagnostics` -> runtime details, paths, log, port, sitePort, projects, checks.
`GET /health` -> `{status:'ok',version,instanceId,pid,port,sitePort,uptime}`; `/ready` -> `{status:'ready'}` or 503.

Admin UI uses fetch same-origin API with sessions. Never store admin credentials in localStorage or pass them to preview. Escaped text for all metadata; HTML from pages only displayed on public origin/sandboxed iframe. No unsafe iframe srcdoc from admin origin.

## Server / CLI boundary

`node src/server.mjs --data-dir <absolute>` starts HTTP from saved instance and writes newline JSON logs to stdout. Environment `LUMASITE_DATA_DIR` default cwd/.lumasite. CLI spawns server detached, stdout/stderr to `<dataDir>/logs/server.log`, pid+instanceId stored in run.json. No parent process modifications. Health identity check before stopping. CLI init calls shared service directly, defaults above. CLI commands init/start/status/health/doctor/logs/restart/stop/credentials/proxy/backup. All accept --data-dir. Start reports actual admin/site/MCP/ports, stop only own verified PID. Proxy exports Apache/Caddy configurations; never changes host server files automatically. Suggested CLI `init --name SendMailOS --domain sendmailos.local --port 4310 --site-port 4311`.

## Design direction

Admin is a professional authoring studio: cool light gray workspace (#f5f6fa), white work surfaces, ink navy (#20283c), cobalt primary (#4359e8), restrained violet for animation library. System sans for UI; monospace only code/URLs. Left project/navigation rail, large live preview, compact source editor and connection/operations views. Functional forms, readable mobile stacking, keyboard focus, reduced motion. Avoid generic marketing cards and fake metrics. UI must create project/page, edit HTML/CSS/JS, save/publish, upload media, select animation snippets, inspect generated URLs, view revisions and runtime.
