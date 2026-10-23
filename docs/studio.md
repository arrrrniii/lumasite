# Studio workspace

Sign in at your installation's `/admin` address. Choose a website to open its Overview. Changing sections does not publish a draft or discard page edits. Switching websites or signing out asks before discarding unsaved edits.

## Find website resources

**Quick links** is available in the top bar of every project section. **Connections → Website links** has Open and Copy controls for each resource:

| Resource | Published preview | Configured production domain |
| --- | --- | --- |
| Website | `/sites/<slug>/` | `/` |
| XML sitemap | `/sites/<slug>/sitemap.xml` | `/sitemap.xml` |
| Robots directives | `/sites/<slug>/robots.txt` | `/robots.txt` |
| RSS articles | `/sites/<slug>/feed.xml` | `/feed.xml` |

Preview addresses use the instance's website origin, separate from administration. These are published-page previews and stay noindex. Production addresses use the saved project domain. Configure DNS, your reverse proxy, and HTTPS on the destination server before using them publicly. Saving a domain does not verify that setup.

The Studio address and project MCP endpoint are in Connections. MCP requires the project's Bearer token and a Streamable HTTP client. Tokens appear only when created or rotated. Generating a new token invalidates the previous one.

## Preview a draft

In Pages, save edits and use **Open draft** beneath the isolated preview. You can also copy that private URL. In Connections, **Get draft link** creates a link for the selected page; **Save & get draft link** first saves pending edits. The link grants access to the saved draft until it expires, so share it only with intended reviewers. Opening or refreshing a draft link does not publish the page.

## Find settings and operations

- **Overview:** total, published, and unpublished page counts; recent pages and tool shortcuts. Published counts indicate pages with a published revision, even when a newer draft exists.
- **Pages:** edit HTML, CSS, browser JavaScript, and page/article SEO; save, preview, publish, and restore published revisions.
- **Media library:** upload images, audio, or video, then open or copy file URLs.
- **Components:** reusable sections and native LumaFX animation recipes.
- **Connections:** addresses, MCP access, domains, installation ports, and site-wide SEO/branding defaults.
- **Runtime:** server health, readiness, ports, process ID, uptime, installation details, and copyable CLI commands. The displayed commands use the installed CLI's location, including generated npm projects.

On mobile, open the menu in the top-left corner. Escape closes it; keyboard focus stays inside the drawer while it is open. Studio fonts are bundled locally and do not require a third-party font request.
