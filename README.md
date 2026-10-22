# LumaSite

A standalone, self-hosted website studio built for MCP authoring. Create a named project, attach its domain, and get its admin, website, and authenticated MCP URLs. Edit HTML, Tailwind classes, CSS, browser JavaScript, media, and LumaFX animations; preview and publish a new revision without redeploying the studio.

LumaSite runs as an independent application. The `marketing/` directory is an optional SendMailOS example; a new instance starts with its own projects, credentials, and media.

## Install from GitHub

Requires Node.js 24 or later and npm. This repository is private; use an authenticated GitHub account or a deploy key with read access when cloning.

```sh
git clone https://github.com/arrrrniii/lumasite.git
cd lumasite
npm ci --omit=dev
node bin/lumasite.mjs init --name "My website" --domain example.com
node bin/lumasite.mjs start
node bin/lumasite.mjs health
```

Open **http://localhost:4310/admin** on the same machine. Initialization prints the new administrator password, project MCP token, ports, and URLs. A remote server needs HTTPS and a reverse proxy before its studio and MCP URLs are reachable from your computer.

On a server, keep persistent data outside the checkout with `--data-dir /srv/lumasite/data`. See [fresh-server installation and updates](docs/install-from-github.md) for the full commands, Apache/Caddy setup, and importing a website ZIP. Git stores the application and optional example sources; export/import moves an existing website. Runtime credentials, server data, ZIP exports, and machine-specific publication/preview reports are excluded from this repository.

## Run locally

Requires Node.js 24 or later and npm.

```sh
cd lumasite
npm ci
node bin/lumasite.mjs init --name SendMailOS --domain sendmailos.local
node bin/lumasite.mjs start
node bin/lumasite.mjs status
```

Save the generated administrator password and MCP bearer token printed by `init`. They are also stored in `.lumasite/credentials.json`, readable only by your operating-system user. `init` configures storage; `start` starts the listeners.

Open **http://localhost:4310/admin** and sign in. The generated project includes a starter homepage draft. Save and publish it in the studio, then open the project's local website URL. A project's URLs look like:

```text
Admin:    http://localhost:4310/admin/projects/<project-id>
MCP:      http://localhost:4310/mcp/<project-id>
Website:  http://localhost:4311/sites/sendmailos/
```

The MCP URL is a Streamable HTTP endpoint and requires the project's bearer token. Enter that endpoint and authorization in a compatible MCP client. The URL itself is not a credential.

The custom domain is saved as project configuration. Local testing works without DNS through `/sites/<slug>/`; entering a domain does not automatically register it or change DNS.

You can optionally run `npm link` and use `lumasite` in place of `node bin/lumasite.mjs`.

## Commands

All commands accept `--data-dir /absolute/directory`. Otherwise storage defaults to `$LUMASITE_DATA_DIR` or `.lumasite` in the current working directory. Always use the same directory for an instance.

| Command | Purpose |
| --- | --- |
| `init --name SendMailOS --domain example.com` | Initialize credentials, ports, and a first project |
| `project create --name "Second website" --domain second.example` | Create a project and print its URLs and bearer token |
| `project list` | List projects and generated URLs |
| `configure --public-url ... --site-url ...` | Change a stopped instance's origins/listeners without resetting its websites |
| `export --project sendmailos --output sendmailos.zip` | Export one website, its media and revision history without credentials |
| `import --file sendmailos.zip --slug sendmailos` | Import a new website and generate a fresh MCP connection |
| `start` | Start the instance in the background and wait for readiness |
| `status` | Show ports, process ID, URLs, logs, and storage |
| `health` | Check both listeners and readiness; exits nonzero if unhealthy |
| `doctor` | Diagnose listeners, process ownership, and storage |
| `logs --lines 100` | Read recent server logs |
| `logs --follow` | Stream new log output; Ctrl+C exits the log viewer |
| `restart` | Stop the verified process and start it again |
| `stop` | Stop only a process verified as belonging to this instance |
| `credentials` | Display private local administrator and project credentials |
| `proxy --format caddy --admin-domain studio.example.com --domain example.com` | Print a reverse-proxy configuration |
| `backup --output /private/backups/lumasite-snapshot` | Save state, credentials, and media to a new directory |

`--json` gives machine-readable output for automation. `logs --follow` emits a text stream and cannot use `--json`.

Set ports and the external studio URL during initialization:

```sh
node bin/lumasite.mjs init \
  --data-dir /srv/lumasite/data \
  --name SendMailOS \
  --domain sendmailos.com \
  --public-url https://studio.example.com \
  --site-url https://preview.example.com \
  --port 4310 \
  --site-port 4311

node bin/lumasite.mjs start --data-dir /srv/lumasite/data
```

The admin/API/MCP listener defaults to `127.0.0.1:4310`. The public website listener defaults to `127.0.0.1:4311`. They are separate origins so project scripts do not execute inside the authenticated administration origin. Use a reverse proxy for remote access.

## What publishing does

The studio and MCP use the same project/page operations. Draft HTML, CSS, and browser JavaScript are stored with revisions. Publishing generates the required Tailwind CSS and saves a published revision. Visitors receive the published revision; an unfinished draft does not replace it. Restoring a revision restores the draft and requires publishing to change the live page.

Browser-ready JavaScript runs on the public website. Editing arbitrary TypeScript, JSX, Node.js code, or bundler-specific packages is not supported by this release. LumaFX is vendored and served by this application; its presets are available from the studio library. Media uploads support images, audio, and video. This release stores originals locally; it does not implement a video transcoding service.

## Move a website with a ZIP

In the studio, choose **Connections → Export ZIP**. On another installed LumaSite instance, choose **Import ZIP**, select the archive, enter its destination name/slug and optional domain, then import. Published pages stay published, drafts stay drafts, and media links are remapped automatically. The imported project receives a new MCP token; local administrator passwords and project credentials are excluded from the archive.

The equivalent CLI commands are:

```sh
node bin/lumasite.mjs export --project sendmailos --output /private/exports/sendmailos.zip
node bin/lumasite.mjs import --file /private/import/sendmailos.zip --slug sendmailos --domain example.com --link-mode domain
```

The destination must have LumaSite installed and initialized. Import creates a new project and refuses to overwrite a conflicting slug/domain. ZIPs contain website source and drafts, so keep them private. See [the ZIP production-transfer guide](docs/production-transfer.md) for destination setup, domains, Apache, Docker, and the alternative full-instance transfer.

## Docker and production hosting

The included Dockerfile and Compose file provide a starting point. The host setup, certificates, DNS, remote MCP clients, and container deployment must be verified on your target server. Local verification alone does not prove those integrations work in production.

```sh
docker compose build
docker compose run --rm lumasite bin/lumasite.mjs init \
  --host 0.0.0.0 \
  --name SendMailOS \
  --domain sendmailos.com \
  --public-url https://studio.example.com \
  --site-url https://preview.example.com
docker compose up -d
docker compose logs -f
```

In a container the service must listen on `0.0.0.0`. Compose publishes both ports on the host's loopback interface, for an Apache or Caddy proxy on that host. Compose runs the server in the foreground and supervises it: use `docker compose stop` or `docker compose restart`, not the detached-process CLI inside the container.

See [operations and deployment](docs/operations.md), [Sitewright comparison](docs/sitewright-comparison.md), and [LumaFX integration](docs/lumafx-integration.md).

## Verification

```sh
npm test
npm run test:browser
```

The CLI tests initialize temporary instances on ephemeral ports, start both listeners, check live project creation, snapshot data, restart and stop the process, follow logs, and verify that unrelated processes cannot be stopped. Browser tests require Playwright's Chromium runtime.

This is a first local release. It includes operational tools and an extensible publishing foundation; it is not yet a replacement for every WordPress plugin, ecommerce workflow, or managed hosting control panel.
