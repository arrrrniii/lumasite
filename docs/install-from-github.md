# Install LumaSite on another server

The GitHub repository contains the studio, CLI, native LumaFX runtime, tests, Docker configuration, and an optional SendMailOS marketing example. Each installation creates its own credentials and project IDs. Existing websites move separately through **Export ZIP → Import ZIP**.

## Install the application

For a packaged command and terminal wizard, see [npm installation and guided setup](terminal-installer.md):

```sh
npm install --global git+https://github.com/arrrrniii/lumasite.git
lumasite setup --mode server --data-dir /srv/lumasite/data
```

Git authentication with read access to this private repository must be configured first. The clone-based workflow below is also available.

Use Node.js 24 or later, npm, and Git. The repository is private: authenticate Git with an account that can read it, or configure a read-only deploy key for the server. Run these commands as the operating-system user that will own the application and its data. Create the `/srv/lumasite` directory with appropriate ownership first.

```sh
git clone https://github.com/arrrrniii/lumasite.git /srv/lumasite/app
cd /srv/lumasite/app
npm ci --omit=dev

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

Initialize the destination once. Its initial project and the imported website must have different slugs/domains; `import` creates a new project and refuses to overwrite an existing one. For example, initialize with `--name "Starter"` and omit `--domain` when the next step is importing your existing website.

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

For a native CLI-managed installation, take a private backup and stop the instance before updating the application:

```sh
cd /srv/lumasite/app
node bin/lumasite.mjs backup \
  --data-dir /srv/lumasite/data \
  --output /srv/lumasite/backups/before-update-001
node bin/lumasite.mjs stop --data-dir /srv/lumasite/data
git pull --ff-only
npm ci --omit=dev
node bin/lumasite.mjs start --data-dir /srv/lumasite/data
node bin/lumasite.mjs health --data-dir /srv/lumasite/data
```

Use a new backup directory each time. Keep the source checkout free of server-specific edits so a fast-forward update can succeed. The separate data directory survives application updates. Read release notes before upgrading; do not rerun `init` as an update or restore command. If an upgrade fails, preserve the backup and use the previous application revision rather than reinitializing the data.

Editing and publishing website HTML/CSS/JavaScript through Studio/MCP does not need this application-update procedure.

## Development and verification

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
```

The built-in test suite uses disposable data and ports. GitHub Actions runs it on pushes and pull requests. Browser tests need Chromium and are run separately. The marketing browser test also requires the optional example to be published first.
