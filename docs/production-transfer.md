# Transfer the existing LumaSite website to production

The simplest website transfer is a portable project ZIP: export the project, install LumaSite on the destination, then import it. This carries the website and its stored media while generating a new project identity and MCP credential. A full private instance snapshot is also supported when you need to preserve the original IDs and credentials. No remote server has been deployed or accessed as part of preparing this guide.

Use your confirmed hostnames in place of these examples:

| Purpose | Example | Internal listener |
| --- | --- | --- |
| Public marketing website | `https://www.example.com` | `127.0.0.1:4311` |
| Private administration and project MCP | `https://studio.example.com` | `127.0.0.1:4310` |
| Isolated draft previews and project-path URLs | `https://preview.example.com` | `127.0.0.1:4311` |

Keep the website/preview origin separate from the authenticated studio origin. The SendMailOS dashboard at `dash.sendmailos.com` is a separate application; transferring this marketing site does not transfer or change that dashboard.

## Recommended: export and import a project ZIP

### 1. Export the existing website

From the source application's `lumasite` directory:

```sh
node bin/lumasite.mjs export \
  --data-dir /absolute/path/to/lumasite/.lumasite \
  --project sendmailos \
  --output /private/exports/sendmailos.zip
```

Use the existing project's ID or slug. Choose a new output filename; the command refuses to overwrite an existing file. It works with a healthy running instance through its authenticated local API, or with a fully stopped instance. It refuses unsafe offline access when a live process or occupied listener cannot be verified.

The ZIP includes project theme, HTML/CSS/JavaScript, draft pages, published pages, revision history, and media stored by LumaSite. It excludes administrator passwords, administrator tokens, and project MCP credentials. References to externally hosted resources still depend on those external hosts. Keep the ZIP private because it contains website source and drafts. Transfer it through your established private server-access method.

### 2. Install LumaSite on the destination

The project ZIP contains website data; install the LumaSite application code separately. Use Node.js 24 or newer, a dedicated unprivileged service account, `/srv/lumasite/app` for code, and `/srv/lumasite/data` for persistent data:

```sh
cd /srv/lumasite/app
npm ci --omit=dev
```

For a **new, empty destination only**, initialize its own administrator account and origins without creating a placeholder project:

```sh
node bin/lumasite.mjs init \
  --data-dir /srv/lumasite/data \
  --public-url https://studio.example.com \
  --site-url https://preview.example.com \
  --host 127.0.0.1 \
  --port 4310 \
  --site-port 4311
```

Retain the generated administrator credential privately. If the destination is already initialized, use it as-is; do not run `init` again. Change an existing destination's origins or ports with the stopped-instance `configure` command documented below.

### 3. Import as a new project

For clean production links, supply the confirmed domain and domain link mode:

```sh
node bin/lumasite.mjs import \
  --data-dir /srv/lumasite/data \
  --file /private/import/sendmailos.zip \
  --name SendMailOS \
  --slug sendmailos \
  --domain www.example.com \
  --link-mode domain
```

Import works before starting the destination or through its healthy running API. It creates a new project, page/media/revision IDs, and MCP token. Media references are remapped to the imported assets. Existing projects remain in place; a conflicting slug or domain is rejected. Use another `--slug` if that project slug is already occupied. The new connection URLs appear in the command output, and the token is saved privately in the destination's `credentials.json` rather than printed by import.

Without `--domain`, the source domain is cleared. The default `--link-mode project` rewrites internal links for `/sites/<imported-slug>/` local/project-path use. `--link-mode domain` requires a domain and rewrites the project's internal navigation for clean root paths such as `/campaigns`. Import retains which revisions were published, so those pages are available immediately. It does not require another marketing-source publication merely to transfer the website. Compressed ZIP uploads are limited to 100 MiB, with additional archive-entry and expanded-size checks.

### Update an existing destination instead

If the destination already has the website, use Studio → Import ZIP → **Update an existing website**, select it, and type its exact slug. From the CLI:

```sh
node bin/lumasite.mjs import \
  --data-dir /srv/lumasite/data \
  --file /private/import/sendmailos.zip \
  --mode update --project sendmailos --confirm sendmailos
```

This preserves the destination project ID, name, slug, domain, and MCP credentials while replacing all pages, media, theme, SEO, and revision history. It saves a recovery ZIP first. Published revisions in the imported ZIP become live immediately. With a configured domain, update defaults to clean domain links; otherwise it uses project paths. Do not pass `--name`, `--slug`, or `--domain` when updating. See [Website management](website-management.md) for deletion and recovery.

### 4. Start, connect the domain, and verify

```sh
node bin/lumasite.mjs start --data-dir /srv/lumasite/data
node bin/lumasite.mjs status --data-dir /srv/lumasite/data
node bin/lumasite.mjs health --data-dir /srv/lumasite/data
node bin/lumasite.mjs doctor --data-dir /srv/lumasite/data
```

Continue with [Apache, DNS, and TLS](#5-apache-dns-and-tls) below. The website domain routes to port 4311; studio and MCP route to 4310. Use the new project MCP URL shown by import and retrieve its token privately from studio Connections or the explicit `credentials` command. The source project's MCP token does not authenticate the imported project.

You can edit and publish the imported website immediately through studio or MCP. If you also plan to use `marketing/publish.mjs`, its local `marketing/published.json` still identifies the source project's old IDs. Compare the imported page contents with canonical source and establish a verified manifest baseline for the imported IDs before source publication; never delete the guard manifest to force it through. For a transfer that must preserve source-publisher IDs and credentials, use the full-instance alternative below.

## Alternative: transfer the complete private instance

This method preserves the existing website, media, page IDs, published revisions, administrator password, and MCP credentials. Restore it into an empty destination data directory without initializing a replacement instance.

### What moves

Copy the application release (`package.json`, lockfile, `src`, `bin`, `public`, `vendor`, and marketing source/assets) and a private data snapshot:

```text
state.json          Instance, projects, drafts, and all published revisions
credentials.json    Existing private administrator and project credentials
media/              Uploaded images, fonts, and other originals
```

Do not copy local `run.json`, lifecycle locks, or `node_modules`. Process IDs are specific to the old machine; dependencies must be installed for the target system. Old logs can be archived separately. Retain `marketing/published.json` with the source release so the publisher's outside-edit checks retain their known baseline.

**Do not run `init`, recreate the project, or upload the media again.** The application already has everything needed to serve its published revisions. Media URLs use preserved project/file IDs, so `/media/<project-id>/<filename>` continues working after the domain changes.

### 1. Take a final private snapshot

From the current `lumasite` directory, using the real absolute source data directory:

```sh
node bin/lumasite.mjs stop --data-dir /absolute/path/to/lumasite/.lumasite
node bin/lumasite.mjs backup \
  --data-dir /absolute/path/to/lumasite/.lumasite \
  --output /private/backups/lumasite-transfer-snapshot
```

The backup destination must be new. Confirm it has no `INCOMPLETE` marker. A brief stop freezes the final content while taking the cutover snapshot. If the local process is supervised or was started in the foreground, stop it with that supervisor or Ctrl+C instead of the CLI.

Create private transfer archives, excluding the live data directory from the application archive:

```sh
umask 077
tar -czf /private/backups/lumasite-state.tgz \
  -C /private/backups/lumasite-transfer-snapshot \
  state.json credentials.json media

tar --exclude=./.lumasite --exclude=./node_modules \
  --exclude=./.git --exclude=./test-results \
  --exclude='./.env' --exclude='./.env.*' \
  -czf /private/backups/lumasite-app.tgz \
  -C /absolute/path/to/lumasite .
```

Transfer these through your established private server-access method. The state archive contains credentials; do not upload it to a public URL or repository. Inspect the application archive's file list before sending it if this checkout contains other private files. Server access details and final domain names must be supplied before an actual deployment.

### 2. Restore the snapshot without setup

On the destination, use Node.js 24 or newer. Keep code and persistent data separate, for example `/srv/lumasite/app` and `/srv/lumasite/data`. Run the application as a dedicated unprivileged account that owns the data directory.

After placing the archives on that server:

```sh
mkdir -p /srv/lumasite/app /srv/lumasite/data
tar -xzf /private/import/lumasite-app.tgz -C /srv/lumasite/app
tar -xzf /private/import/lumasite-state.tgz -C /srv/lumasite/data
chmod -R go-rwx /srv/lumasite/data
cd /srv/lumasite/app
npm ci --omit=dev
```

Use an empty destination data directory and the intended service account. Correct ownership if an administrator extracted the archive on its behalf. Do not place the data directory in Apache's document root or enable static access to it. The runtime exposes only the media endpoints it supports.

### 3. Set the production origins on the restored instance

With every process using the restored data stopped, use the supported `configure` command:

```sh
cd /srv/lumasite/app
node bin/lumasite.mjs configure \
  --data-dir /srv/lumasite/data \
  --public-url https://studio.example.com \
  --site-url https://preview.example.com \
  --domain www.example.com \
  --project sendmailos \
  --host 127.0.0.1 \
  --port 4310 \
  --site-port 4311
```

The command preserves instance/project/page IDs, content, revision history, media, and credentials. Its output shows the addresses and generated project URLs without printing tokens. `--project` accepts the existing project ID or slug and selects the project whose `--domain` changes. Omitted settings are preserved; set both public origins explicitly when migrating to another host or changing ports.

`configure` refuses to change a running instance, an unverified live recorded process, or occupied old/new listener ports. It never stops or signals another process. Stop a foreground server, operating-system service, or container through its own manager first. Do not edit `state.json` while the server runs: its in-memory store can overwrite external changes. `proxy --admin-domain` generates configuration text and does not substitute for this step.

### 4. Start and check the internal service

```sh
cd /srv/lumasite/app
node bin/lumasite.mjs start --data-dir /srv/lumasite/data
node bin/lumasite.mjs status --data-dir /srv/lumasite/data
node bin/lumasite.mjs health --data-dir /srv/lumasite/data
node bin/lumasite.mjs doctor --data-dir /srv/lumasite/data

curl -fsS http://127.0.0.1:4310/health
curl -fsS http://127.0.0.1:4310/ready
curl -fsS http://127.0.0.1:4311/health
curl -fsS -H 'Host: www.example.com' http://127.0.0.1:4311/
```

`/ready` exists on the admin listener; the website listener exposes `/health`. Both health responses should identify the same restored instance. The private interfaces stay on loopback behind Apache. The CLI checks instance identity before stopping a process.

Native `start` runs in the background, but does not install an operating-system boot service. Use a proper process supervisor for automatic startup/recovery, or the Docker option below. When supervised, use that supervisor for restart/stop rather than the CLI's detached-process commands.

## 5. Apache, DNS, and TLS

Create A/AAAA records for the three confirmed hostnames pointing to the destination server. Avoid an AAAA record if IPv6 is not actually routed. `www` is not automatically another domain alias in LumaSite: choose one primary website hostname and redirect any secondary hostname to it in the proxy.

Generate the supported Apache configuration:

```sh
node bin/lumasite.mjs proxy \
  --format apache \
  --project sendmailos \
  --admin-domain studio.example.com \
  --domain www.example.com \
  --output /private/import/lumasite-apache.conf \
  --data-dir /srv/lumasite/data
```

The file must not already exist. The generator forwards `studio.example.com` to port 4310 and the website plus configured preview hostname to port 4311, retaining the original Host header. It does not modify Apache or issue certificates. Review and install the file through your server's existing configuration workflow. On a Debian/Ubuntu Apache host, the usual administrator commands are:

```sh
sudo a2enmod proxy proxy_http headers ssl
sudo apachectl configtest
sudo systemctl reload apache2
sudo certbot --apache \
  -d studio.example.com -d preview.example.com -d www.example.com
```

Certificate tooling, site-file locations, enabled virtual hosts, firewall rules, and service names depend on the target server. Confirm the site is enabled before reloading. The generated vhosts initially use HTTP; add valid HTTPS certificates and redirects before transmitting administrator passwords or MCP credentials. Keep `ProxyPreserveHost On`, preserve Streamable HTTP request/response streaming, and allow the application's intended media-upload sizes. Do not expose ports 4310/4311 publicly merely to avoid configuring the proxy.

Verify the final HTTPS website, all nine pages, images/fonts, studio sign-in, draft preview, and a project-scoped MCP read. The existing project ID and token remain valid, but clients must use the new studio-origin endpoint: `https://studio.example.com/mcp/<existing-project-id>`. Enter authentication in the client's settings; do not paste credentials into page source or public command logs.

## Existing links and clean production URLs

From LumaSite 0.8.1, a project's configured domain serves its homepage at `/` and pages at paths such as `/pricing` and `/developers`. The production renderer adapts navigation links from older ZIP imports automatically: `/sites/sendmailos-live/pricing` becomes `/pricing`. It also handles explicit project-path links on the configured preview origin or the same production domain. Queries and fragments are retained, including `/developers#template-studio`.

On that project's own domain, old `/sites/<slug>/...` addresses return a **301** to the clean path. On the shared preview origin and localhost, those addresses continue serving the project with noindex. Links to external services or other projects are preserved. Set the exact production hostname in **Connections → Website settings**, and keep `ProxyPreserveHost On` in Apache so LumaSite sees it. Redirect secondary hostnames such as `www` to your primary hostname in the proxy.

This works on existing published pages after upgrading the runtime; it does not require another import or publication. LumaSite rewrites rendered navigation attributes (`href` on anchors/areas and form destinations), while retaining saved HTML, revisions, media, CSS/JavaScript asset URLs, and MCP credentials. Custom JavaScript that constructs project-path URLs still reaches the clean address through the 301; author root paths in that code to avoid an extra request. Canonical URLs and the production sitemap continue using the configured domain.

Use [the upgrade commands](website-management.md#upgrade-an-existing-generated-installation), then check:

```sh
curl -fsSI https://example.com/pricing
curl -sSI 'https://example.com/sites/my-website/pricing?plan=pro'
curl -fsS https://example.com/sitemap.xml
```

The first request should return 200; the second should return 301 with `Location: /pricing?plan=pro`. Check desktop and mobile menu links, fragment targets, preview URLs, and the production canonical tags after upgrading. Existing CDN caches may need a refresh if they retain older HTML.

## How navigation works and what affects speed

The website serves complete published HTML. A link starts a normal browser navigation immediately; there is no artificial transition delay or full-screen loading gate. Browser history, back/forward, and links work without a client-side router. Saving/publishing HTML, CSS, or JavaScript updates does not require an application rebuild or process restart.

Hover, keyboard focus, or touch intent can prefetch one of the nine known same-origin public pages. The code uses [Speculation Rules](https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API) where supported, with a document-prefetch fallback. It avoids admin/MCP routes, external sites, query URLs, and prerendering. Prefetching is skipped for data-saving preferences and reported slow-2G/2G connections; it remains a browser-controlled optimization, not a prerequisite for navigation.

Pages and their headings appear immediately, without arrival fades, character reveals, or entrance animations. Requests use ordinary browser navigation without a waiting overlay; no cross-document rendering transition is required.

Published HTML revalidates through `Cache-Control: no-cache`. Published CSS and JavaScript use content-hash URLs under `/content-assets/`, so pages with identical asset contents reuse the same cached resource even when their revision IDs differ. These assets and uploaded images/fonts are served with long immutable caching. New content produces new URLs; old published revisions remain available. Final speed still depends on the server, network, and image sizes, so test on the actual production host. Keep authenticated studio responses private rather than adding public caching to them.

## Docker alternative for the same restored data

The included Dockerfile uses Node 24 and the `node` user. The included Compose file maps both listeners to host loopback and normally mounts a named volume. **Import the existing snapshot before startup; do not run the README's fresh-install `init` command.**

For a deliberate bind-mount deployment, a server-local Compose override can replace the `/data` mount with `/srv/lumasite/data` and set the supported listener override:

```yaml
services:
  lumasite:
    volumes:
      - /srv/lumasite/data:/data
    environment:
      LUMASITE_DATA_DIR: /data
      LUMASITE_HOST: 0.0.0.0
```

Inside a container the application must bind `0.0.0.0` so published ports reach it. Keep Compose's host mappings on `127.0.0.1` for Apache. Make the restored files readable/writable by the image's `node` account (UID 1000 in the standard base image); confirm ownership for your built image rather than loosening file permissions.

```sh
docker compose build
docker compose up -d
docker compose ps
docker compose exec lumasite node bin/lumasite.mjs health
docker compose logs --tail 100 -f
docker compose restart
docker compose stop
```

Run either the native service or the container on these ports, not both. Compose supervises the foreground server and has log rotation/restart policy. It does not provision the VPS, enable Docker at boot, install Apache, or manage the server's DNS.

## Routine operations and rollback

For a CLI-managed native process:

```sh
node bin/lumasite.mjs logs --lines 200 --data-dir /srv/lumasite/data
node bin/lumasite.mjs logs --follow --data-dir /srv/lumasite/data
node bin/lumasite.mjs restart --data-dir /srv/lumasite/data
node bin/lumasite.mjs stop --data-dir /srv/lumasite/data
node bin/lumasite.mjs backup \
  --data-dir /srv/lumasite/data \
  --output /srv/private-backups/lumasite-after-cutover
```

Use a new backup destination every time. Native CLI logs are in `/srv/lumasite/data/logs/server.log`; arrange rotation separately. For Docker, use Compose logs/lifecycle commands. For page-content rollback, restore a previous draft in studio History and publish it. For a complete deployment rollback, stop the service and restore the private pre-cutover snapshot into an empty data directory; verify addresses, ownership, health, and media before restarting.

The remaining deployment decisions are the destination server, actual hostnames, DNS/TLS setup, and supervisor choice. ZIP import transfers the website into a fresh project; a private instance snapshot preserves its original identity and credentials. Published pages on their configured production domain allow indexing unless the page or site has noindex enabled. Project paths on the preview origin and signed draft previews retain `noindex`; verify final production response headers, canonicals, sitemap, and image URLs during cutover. See [SEO and blogs](seo-and-blog.md). The existing website does not need to be rebuilt from scratch.
