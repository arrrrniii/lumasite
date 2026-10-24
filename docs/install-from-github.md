# Install LumaSite

The GitHub repository contains the studio, CLI, native LumaFX runtime, tests, Docker configuration, and an optional SendMailOS marketing example. Each installation creates its own credentials and project IDs. Existing websites move separately through **Export ZIP → Import ZIP**.

## Recommended: create a project with the wizard

Install **Node.js 24 or later and npm**, then run:

```sh
npm create lumasite@latest
```

The npm packages and GitHub repository are public. Registry installation does not need Git, a GitHub account, an access token, a global CLI, or an npm account. For laptop testing, use `npm create lumasite@latest -- --local`.

1. Enter a new project folder, for example `my-website`.
2. Server mode is the default. Use the `--local` flag for a laptop trial; the creator no longer asks local/server.
3. Leave the ZIP question empty for a new website, or enter an exported LumaSite ZIP path.
4. Enter the website name. Server mode also asks for the domain, Studio/preview URLs, ports, and reverse proxy.
5. Review the settings and confirm. The wizard installs dependencies, creates private credentials and MCP access, and optionally starts the app.

```sh
cd my-website
npm run status
npm run health
```

Open the printed **Studio URL**, sign in with the generated administrator password, and publish the starter homepage under **Pages**. A draft is not public until published. The installed runtime stays inside your project after npx's temporary cache is removed. Your generated `README.md` records addresses, commands, feature guides, and recovery steps.

[See the illustrated questions and answers](wizard-walkthrough.md). [All flags and unattended setup](terminal-installer.md).

### Finish server routing

The default Studio/API/MCP listener is `127.0.0.1:4310`, and the separate website/media listener is `127.0.0.1:4311`. The wizard chooses available defaults. Use the actual ports shown in its summary.

For `example.com`, the usual routing is:

| DNS name | Proxy destination | Purpose |
| --- | --- | --- |
| `studio.example.com` | `127.0.0.1:4310` | Studio and authenticated MCP |
| `preview.example.com` | `127.0.0.1:4311` | Website previews and media |
| `example.com` | `127.0.0.1:4311` | Published website at clean paths such as `/pricing` |

Point the DNS records at your server. Review the generated configuration in `.lumasite/deployment/`, activate it in your existing proxy, configure HTTPS, and arrange startup after reboot with a supervisor. The installer detects proxies and prepares files; it does not change DNS, replace existing sites, issue certificates, or install a boot service. Read [Apache/Caddy/Traefik operations](operations.md) and [server detection](server-detection.md).

### Configure the website in Studio

| Area | Next step |
| --- | --- |
| Connections | Copy MCP/preview/sitemap links; set domain, SEO defaults, logo, and favicon |
| Global layout | Share the header, footer, CSS, and JavaScript across pages |
| Integrations | Add Analytics, Tag Manager, Search Console verification, or custom snippets |
| Forms & email | Create a form and save SMTP sender/recipient settings; test before enabling notifications |

See [forms and SMTP](forms-and-email.md), [global layout](global-layout.md), [integrations](integrations.md), and the [SEO example](seo-example.md). A new installation contains its own data; SendMailOS is an optional source example.

## Alternative: clone the application source

Use this when you want to operate a Git checkout directly. It is an alternative to the project creator, not an extra step after it. Run as the operating-system user that will own the application/data. Prepare `/srv/lumasite` with appropriate ownership first. These examples use the CLI inside the checkout rather than the generated project's `npm run` scripts.

```sh
git clone --branch v0.12.0 --depth 1 https://github.com/arrrrniii/lumasite.git /srv/lumasite/app
cd /srv/lumasite/app
npm ci --omit=dev --ignore-scripts

node bin/lumasite.mjs init \
  --data-dir /srv/lumasite/data \
  --name "My website" \
  --domain example.com \
  --public-url https://studio.example.com \
  --site-url https://preview.example.com \
  --port 4310 \
  --site-port 4311

node bin/lumasite.mjs start --data-dir /srv/lumasite/data
node bin/lumasite.mjs health --data-dir /srv/lumasite/data
node bin/lumasite.mjs status --data-dir /srv/lumasite/data
```

Save the administrator password and project MCP token printed by initialization. The website gets a draft starter page, admin URL, MCP endpoint, and local website URL. Save and publish the starter page through the studio to make it public.

The administration/API/MCP listener uses `127.0.0.1:4310`; public websites and media use `127.0.0.1:4311`. Persistent state and uploaded media live in `/srv/lumasite/data`, outside Git. Use the same `--data-dir` on every command. Set `LUMASITE_DATA_DIR=/srv/lumasite/data` in your service environment if preferred.

Domains require DNS records pointing to the server, a reverse proxy, and TLS certificates. Generate an Apache configuration with:

```sh
node bin/lumasite.mjs proxy \
  --data-dir /srv/lumasite/data \
  --format apache \
  --admin-domain studio.example.com \
  --domain example.com \
  --output /srv/lumasite/lumasite-apache.conf
```

Review and install the generated configuration using [the Apache/Caddy/Traefik operations guide](operations.md). It routes the studio and MCP to the admin listener, and the preview/website hosts to the public listener. The CLI prints configuration; it does not change DNS, install certificates, or reload Apache. Keep the two listener origins separate. Native `start` runs in the background; use a supervisor for automatic startup after a server reboot, or use the included [Docker Compose setup](operations.md#docker-supervision).

## Import an existing website

For a new installation, select the ZIP during the recommended wizard flow; this avoids creating an extra starter website. In an existing Studio, choose **Import ZIP → Create a new website**, or **Connections → Manage website → Update from ZIP** to replace the selected website while preserving its identity and credentials. [Update and recovery guide](website-management.md).

The clone-based CLI example below creates a new project, so its slug/domain must be unused. If preparing a checkout for this workflow, initialize with `--name "Starter"` and omit `--domain` before importing the intended domain.

Upload the private ZIP archive outside the application checkout, then run:

```sh
node bin/lumasite.mjs import \
  --data-dir /srv/lumasite/data \
  --file /srv/private-imports/website.zip \
  --name "My website" \
  --slug my-website \
  --domain example.com \
  --link-mode domain

node bin/lumasite.mjs project list --data-dir /srv/lumasite/data
```

The studio's **Import ZIP** dialog performs the same operation. Pages, drafts, media, theme, and publication history transfer together; the destination generates a fresh MCP token. Connect the returned endpoint and token in your MCP client. Administrator credentials stay local to the destination. See [production transfer](production-transfer.md) for the full workflow and verification.

Git intentionally excludes local `marketing/published.json` and `marketing/preview.json` reports. An imported site is immediately editable through Studio/MCP. Before using the optional bulk marketing-source publisher against an imported project, reconcile its source and publication baseline with the new IDs as described in [the editing guide](edit-marketing-elements.md); do not blindly publish over imported edits.

## Check and control the server

```sh
node bin/lumasite.mjs doctor --data-dir /srv/lumasite/data
node bin/lumasite.mjs logs --data-dir /srv/lumasite/data --lines 100
node bin/lumasite.mjs logs --data-dir /srv/lumasite/data --follow
node bin/lumasite.mjs restart --data-dir /srv/lumasite/data
node bin/lumasite.mjs stop --data-dir /srv/lumasite/data
```

`status` shows ports, process identity, URLs, logs, and storage. `health` and `doctor` exit nonzero when checks fail. CLI lifecycle commands apply to a native CLI-managed process. Use your supervisor's commands for Docker or systemd-managed processes.

## Update the application

For a project created by the wizard, run from its folder:

```sh
cd /path/to/my-website
npm stop
node lumasite.mjs backup --output /absolute/private-backups/before-0.12.0
npm install lumasite@0.12.0 --omit=dev --ignore-scripts
npm start
npm run health
```

This example targets v0.12.0; select the intended version from [releases](https://github.com/arrrrniii/lumasite/releases). The direct `backup` command works with older generated folders too. New v0.11.1 projects also include `npm run backup`.

For the alternative Git-checkout installation:

```sh
cd /srv/lumasite/app
node bin/lumasite.mjs stop --data-dir /srv/lumasite/data
node bin/lumasite.mjs backup \
  --data-dir /srv/lumasite/data \
  --output /srv/lumasite/backups/before-update-001
git fetch --tags origin
git checkout --detach v0.12.0
npm ci --omit=dev --ignore-scripts
node bin/lumasite.mjs start --data-dir /srv/lumasite/data
node bin/lumasite.mjs health --data-dir /srv/lumasite/data
```

Use a new private backup directory each time; it includes credentials, any form submissions, and the SMTP encryption key. Preserve your data directory across updates. Keep a source checkout free of server-specific edits. Use your supervisor's stop/start commands for Docker/systemd. Read release notes before upgrading; do not rerun `create`, `setup`, or `init` as an update or restore command. If an upgrade fails, preserve the backup and use the previous application revision rather than reinitializing the data.

Editing and publishing website HTML/CSS/JavaScript through Studio/MCP does not need this application-update procedure.

## Development and verification

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
```

The built-in test suite uses disposable data and ports. GitHub Actions runs it on pushes and pull requests. Browser tests need Chromium and are run separately. The marketing browser test also requires the optional example to be published first.
