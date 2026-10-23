# Operating LumaSite

## Storage and credentials

Use an absolute `--data-dir` for scripts and services. A typical directory contains:

```text
state.json          Instance, projects, drafts, and published revisions
credentials.json    Private administrator password/API token and project tokens
oauth.json          Private OAuth client credentials and hashed grants/tokens
forms.sqlite        Private form submissions, SMTP settings, and delivery queue
smtp.key            Private key for encrypted SMTP passwords; keep with the database
media/              Uploaded originals grouped by project
project-backups/    Private recovery ZIPs from website updates and deletions
logs/server.log     Native CLI server stdout and stderr
run.json            CLI-owned process ID and instance identity
```

Keep this directory private and back it up. Do not serve it directly with Apache, Caddy, or another static file server. LumaSite exposes media through its website listener. Never put `credentials.json` into source control, public backups, issue reports, or website assets.

`init` generates a strong password by default. To supply a password without putting it in shell history, set `LUMASITE_PASSWORD` using your normal secret management workflow before running `init`; do not place it in a checked-in `.env` file. `credentials` intentionally prints secrets, so use it only in a private terminal.

## Daily operations

These examples assume the `lumasite` command is linked with `npm link`; `node /path/to/lumasite/bin/lumasite.mjs` works equivalently.

```sh
lumasite status --data-dir /srv/lumasite/data
lumasite health --data-dir /srv/lumasite/data
lumasite doctor --data-dir /srv/lumasite/data
lumasite detect
lumasite logs --lines 200 --data-dir /srv/lumasite/data
lumasite logs --follow --data-dir /srv/lumasite/data
lumasite restart --data-dir /srv/lumasite/data
lumasite stop --data-dir /srv/lumasite/data
```

`status` prints both ports, process identity, local and project URLs, the data directory, and the log file. `status`, `health`, and `doctor` exit with code 1 when checks fail. JSON mode is available for monitoring:

```sh
lumasite health --json --data-dir /srv/lumasite/data
```

The public endpoints `/health` and `/ready` can also be used by a supervisor. A healthy response must identify the expected instance; a different process returning HTTP 200 is not accepted as this instance.

The native CLI redirects background output to `logs/server.log`. Log rotation is not included in this release. Arrange rotation on the server if running continuously. Docker Compose uses its configured container log rotation instead.

## Process ownership

`start` creates `run.json` with the spawned PID and instance ID. A second `start` returns the existing instance when both listeners are healthy. `stop` checks the live `/health` identity and PID before sending SIGTERM. It never kills a process just because it is listening on a configured port, never stops another instance, and never escalates automatically to SIGKILL.

If the recorded PID is alive but neither listener can verify it, the CLI refuses to signal it. Use `doctor`, examine logs, and inspect the process with your operating system before stopping it directly. A genuinely dead PID record is removed automatically. The `.control.lock` file serializes lifecycle commands and recovers locks belonging to dead CLI processes.

If you run `node src/server.mjs --data-dir ...` in the foreground, stop it with Ctrl+C. If you run with systemd or Docker, use that supervisor for restart/stop. Native CLI `stop` intentionally will not claim a foreground or container process that has no CLI PID record.

## More projects

```sh
lumasite project create \
  --name "Agency website" \
  --domain agency.example.com \
  --data-dir /srv/lumasite/data

lumasite project list --data-dir /srv/lumasite/data
```

Each project receives its own ID, admin page, MCP endpoint, local website path, and bearer token. While the instance runs, project commands use the authenticated API so the change is immediately visible in the studio. New project hostnames require DNS and a proxy virtual host. Project tokens do not grant administrator access to other projects.

## Apache deployment

Keep the native service bound to `127.0.0.1`. Choose distinct administrator, preview/media, and website domains, for example `studio.example.com`, `preview.example.com`, and `example.com`, and point their DNS records at your server. Set the first two during initialization with `--public-url https://studio.example.com --site-url https://preview.example.com`.

Generate a file for review:

```sh
lumasite proxy \
  --format apache \
  --admin-domain studio.example.com \
  --domain example.com \
  --output ./lumasite-apache.conf \
  --data-dir /srv/lumasite/data
```

This generates an HTTP virtual host for each listener, with the configured preview/media hostname as an alias of the public listener. It does not install Apache modules, change `/etc`, open firewall ports, issue certificates, or reload services. On a Debian/Ubuntu Apache installation, an administrator can enable the required modules with `sudo a2enmod proxy proxy_http headers ssl`, install the reviewed configuration in the site's configuration directory, then validate it with `sudo apachectl configtest` before reloading Apache. Other distributions use different commands and paths.

Install TLS certificates for both domains before using administrator login or MCP over the public internet. For a Certbot-managed Apache host, the corresponding command is typically:

```sh
sudo certbot --apache -d studio.example.com -d preview.example.com -d example.com
```

Review the generated HTTPS configuration, redirects, renewal schedule, request-body limits for media, and proxy timeouts for Streamable HTTP MCP. Keep `ProxyPreserveHost On` so the public listener can identify a project from its domain. Do not place the website and authenticated studio on the same origin.

## Caddy deployment

```sh
lumasite proxy \
  --format caddy \
  --admin-domain studio.example.com \
  --domain example.com \
  --output ./Caddyfile \
  --data-dir /srv/lumasite/data

caddy validate --config ./Caddyfile
```

Caddy can issue HTTPS certificates after DNS points to the server and ports 80/443 are reachable. Review the file and install it using your existing Caddy service workflow. The CLI only generates configuration; it does not mutate the server or claim certificates have been issued.

The platform's `publicUrl` must be its final HTTPS studio origin so the generated MCP/admin links are usable remotely. Configure it during initialization with `--public-url https://studio.example.com`. Set `--site-url https://preview.example.com` for the isolated public origin used for signed previews, local-path website links, and media. The proxy generator includes this hostname automatically. Adding a project domain does not change either platform URL.

## Traefik deployment and server detection

Run `lumasite detect` (or `npm run detect` in a generated v0.6+ project) for a read-only report of installed/running proxies, Docker networking, and ports 80/443. Server-mode setup uses this report to suggest an existing proxy; it does not activate or reload one.

```sh
lumasite proxy --format traefik \
  --traefik-entrypoint websecure \
  --traefik-cert-resolver existing-resolver \
  --output ./lumasite-dynamic.yml \
  --data-dir /srv/lumasite/data
```

Replace the entrypoint/resolver names with those already defined in your Traefik installation. Load the generated dynamic YAML through the existing file provider. A Docker proxy needs a backend address reachable from its own network; `127.0.0.1` refers to the container. [The detection and Traefik guide](server-detection.md) explains the files, flags, Docker setup, and verification limits.

## Docker supervision

Use the instructions in [README](../README.md) to initialize the named persistent volume, then:

```sh
docker compose up -d
docker compose ps
docker compose logs --tail 100 -f
docker compose restart
docker compose stop
```

For health or project commands against the running container:

```sh
docker compose exec lumasite node bin/lumasite.mjs health
docker compose exec lumasite node bin/lumasite.mjs project list
```

The included image exposes 4310/4311; if you choose different instance ports, update the Compose mappings and container health check too. The image's health check uses 4310 by default. The built-in application listeners must bind `0.0.0.0` inside Docker, while the host port mappings stay on `127.0.0.1`.

## Backups and restoring

```sh
lumasite backup \
  --data-dir /srv/lumasite/data \
  --output /srv/private-backups/lumasite-2026-10-22
```

The destination must be new and outside the live data directory. A snapshot includes a consistent `state.json`, administrator/project credentials, OAuth state, immutable media, recovery ZIPs, and any forms database and SMTP encryption key. The CLI uses SQLite's backup API to capture the database; do not copy a live `forms.sqlite` file alone or separate it from `smtp.key`. It excludes process IDs, logs, and lifecycle locks. It contains secrets and private submissions; protect it like the live data directory. An `INCOMPLETE` marker means the backup failed and must not be treated as a restore point.

Projects created with v0.11.1 or later can run `npm run backup` from their project folder. It selects a new timestamped destination beside the data directory, or accepts `npm run backup -- --output /absolute/private-backups/before-update-001`. Generated Git ignore rules exclude default backup folders. Older generated projects can use `node lumasite.mjs backup`.

For maximum certainty, stop the instance before a full operational backup. Restore by stopping the destination instance, copying the snapshot contents into an empty private data directory, excluding `backup.json`, confirming file ownership/permissions, and running `start --data-dir /restored/path`. Do not run the original and restored instance simultaneously on the same domains or ports. Verify `health`, project previews, published pages, and uploaded media after restoring.

## Current limits

- The installer initializes the application and projects. It does not provision VPS accounts, register domains, change DNS, or enable a boot-time service.
- The native background process survives the CLI session; automatic start after server reboot requires a supervisor or the included Compose setup.
- Tailwind compilation happens inside publishing. Changing a page does not require redeploying LumaSite, but publishing is still a generation step.
- Page JavaScript executes in visitors' browsers. New backend features and integrations require application development and a platform update.
- Media storage is local. Dedicated object storage, image transformations, video transcoding, quotas, and distributed operations are future extensions.
- Verify the reverse proxy, external HTTPS/MCP authentication, backups, and reboot behavior on the actual deployment host before operating a public service.

## Website updates and deletion

Studio → Connections → Manage website supports replacement imports, deletion with slug confirmation, and recovery ZIP downloads. See [Website management](website-management.md). Recovery ZIPs live in the private data directory; they are never served by the public website listener. Keep them within your storage and backup policy.

## OAuth connections

From 0.8.0, ChatGPT can connect with OAuth. Discovery, registration, and consent run on the Studio origin. App access is limited to one website and revocable under Connections → Connected apps. Keep `oauth.json` with private full-instance backups; project ZIPs exclude it. See [OAuth setup and Apache routing](oauth.md).
