# Update, delete, and recover websites

LumaSite 0.7.0 supports both **Create a new website** and **Update an existing website** in the ZIP import dialog. Creating a website remains the default. A ZIP exported by an older release still works.

## Update a website from ZIP

1. Export the source website as a LumaSite project ZIP.
2. Open the destination website in Studio → **Connections → Manage website → Update from ZIP**. You can also open Import ZIP and change **Import action**.
3. Check the selected website. The chooser includes its name, domain, and slug so similarly named websites can be distinguished.
4. Select the ZIP and type the destination’s exact slug.
5. Review the links and choose **Update website**.

| Data | Update behavior |
| --- | --- |
| Project ID, name, slug, domain, creation date | Preserved from the destination |
| MCP endpoint and existing Bearer token | Preserved; clients stay connected |
| Pages, drafts, selected published revisions, history | Replaced by the ZIP’s content |
| Media, theme, site SEO and page SEO | Replaced and references remapped |
| Website integration settings | Preserved from the destination |
| Other websites and their credentials | Preserved |
| Page, revision and media IDs | Regenerated; old editor/preview references expire |
| Previous destination content | Saved in a private recovery ZIP |

This is a complete content replacement, not a merge. Pages absent from the ZIP are removed. Published revisions in the ZIP become live immediately; unpublished drafts remain private. With an existing domain, update defaults to clean root links such as `/pricing`; without a domain it uses `/sites/<slug>/`. You can select project links explicitly. Identity settings can be changed separately in Connections.

The update does not create another website. If another session changes the destination while validation, staging, or backup is running, the operation stops with a conflict. Refresh and retry with the current content. Old page editors cannot save over the replacement because their page IDs no longer exist.

CLI equivalent, using a generated project folder:

```sh
node lumasite.mjs import --file ./website.zip \
  --mode update --project sendmailos --confirm sendmailos
```

Use the exact destination ID or slug for `--project`, and its slug for `--confirm`. Add `--data-dir /absolute/data/path` if needed. Do not supply `--name`, `--slug`, or `--domain` in update mode. The CLI uses the authenticated API when the instance is running; it writes offline only when the instance is verified stopped.

## Delete a website

Open **Connections → Manage website → Delete website**. Check the website name, domain, slug, and page count, then type its exact slug. LumaSite saves a recovery ZIP before removing the website’s project, pages, revisions, media, and saved project credential.

Its website URLs and MCP endpoint stop working. The domain becomes available for another LumaSite project. Other websites keep running. DNS records, Apache/Caddy/Traefik configuration, and external caches remain managed on your server; deletion does not edit them.

```sh
node lumasite.mjs project delete --project sendmailos --confirm sendmailos
```

## Recover previous content

Open **Your websites → Recovery ZIPs**, or **Connections → Manage website → View recovery ZIPs**. Recovery downloads require an administrator session, including after the original website is deleted.

- To undo an update, download its **Before update** ZIP and import it in **Update an existing website** mode. Select the same destination to preserve its identity and MCP access.
- To restore a deleted website, download its **Before delete** ZIP and import it as a new website. The new website receives new project IDs and MCP credentials. Set its domain explicitly if needed.

Recovery ZIPs contain pages, history, media, theme, and SEO. They exclude instance passwords and MCP tokens. They are written with private file permissions under `<data-dir>/project-backups/`; metadata lives in `state.json`. Downloads verify their recorded size and SHA-256. Never expose the data directory through a static web server.

Recovery ZIPs remain until removed through server storage administration; this release has no automatic retention or purge. Account for their disk usage. Full-instance backups include them. If exporting the current website fails, its files are missing, a credential is embedded in page source, or the project exceeds the supported transfer limits, update/deletion stops before changing active content. Fix the export problem first. Transfer limits remain 100 MiB compressed, 250 MiB expanded, and 50 MiB per media file.

A failed state write rolls back staged replacement files. Once deletion or update commits, a cleanup warning means old files or saved credential cleanup needs server attention; removed content is no longer served. Existing browser/CDN caches can retain previously downloaded public assets until their cache policy expires.

## Upgrade an existing generated installation

For a folder created by the wizard, keep its data directory and upgrade its installed dependency. Do not run `create` or `init` again.

```sh
cd /path/to/my-website
npm stop
node lumasite.mjs backup --output /private/backups/lumasite-before-0.11.1
npm install "lumasite@git+https://github.com/arrrrniii/lumasite.git#v0.11.1" --omit=dev --ignore-scripts
npm start
npm run health
```

The backup destination must be a new directory and is private: it includes credentials. If supervised by systemd or Docker, stop/start through that supervisor and use your existing deployment process. Existing project data and credentials are retained. Refresh Studio after upgrading. Projects duplicated by an earlier import are not automatically merged or deleted; choose the correct project explicitly.
