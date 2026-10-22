# Editing the SendMailOS website

You can change a page's content, layout, colors, inline SVG illustrations, and browser interactions without restarting or redeploying LumaSite. Save a draft, check its preview, then publish it. Publishing generates Tailwind CSS and saves a new website revision internally.

**The current website studio is a source editor with a live preview. It does not yet have a click-to-select or drag-and-drop website canvas.** You edit an element through HTML/CSS/JavaScript or ask an MCP assistant to make the change. SendMailOS's separate visual email-template editor is a different product feature.

## Edit a page in the studio

1. Open `http://localhost:4310/admin` on the machine running LumaSite and sign in.
2. Select **SendMailOS**, open **Pages**, and choose the homepage or another page.
3. Use the **HTML**, **CSS**, and **JS** tabs. HTML contains text, buttons, sections, and inline illustrations; CSS controls their appearance; JS controls browser interactions. **Settings** contains the title, description, and page path.
4. Choose **Save draft**. Refresh the draft preview and use its desktop, tablet, and mobile controls.
5. Choose **Publish page** to make the saved draft live. Save alone does not change what visitors see.

For example, find the homepage heading in HTML to change its wording. Change a button's text or `href` on its `<a>` element. Adjust the relevant CSS class to change spacing, typography, colors, or layout. SVG elements inside the page HTML remain editable source.

The local public homepage is `http://localhost:4311/sites/sendmailos/`. Use the URLs shown in **Connections** if the instance runs on other ports or domains.

## Ask MCP to change elements

Open the project's **Connections** view and configure a compatible MCP client with that project's endpoint and bearer authentication. A local endpoint has this shape:

```text
http://localhost:4310/mcp/<project-id>
```

Keep the project's credential in the client's authentication settings. Do not put it in page code or an ordinary chat message. A cloud client cannot reach your machine's `localhost`; it needs a reachable HTTPS MCP endpoint. Publishing the website through a public preview URL does not by itself expose its admin/MCP listener.

Useful prompts:

> In SendMailOS, change the homepage headline to “Your email. Working together.” Keep the existing layout. Save a draft and show me the preview.

> Make the primary buttons cobalt blue, increase their corner radius, and keep the text contrast readable. Check desktop and mobile before publishing.

> On the Automations page, change the illustration labels and slow its animation. Respect reduced motion. Save a preview first.

These are the **actual LumaSite tools**, implemented in `src/mcp.mjs`:

| Tool | Input | Result |
| --- | --- | --- |
| `project_get` | `{}` | Project settings and generated URLs. |
| `pages_list` | `{}` | Page IDs, paths, draft revisions, and current published revision IDs. |
| `page_get` | `{ "pageId": "<uuid>" }` | Full editable HTML, CSS, JS, metadata, and revision number. |
| `page_upsert` | Optional `pageId`, `title`, `slug`, `description`, `html`, `css`, `js`, `revision` | Create a page or update its draft. Supply `pageId` to update an existing page and its latest `revision` to detect conflicts. |
| `preview_url` | `{ "pageId": "<uuid>" }` | A signed draft preview URL valid for ten minutes. |
| `page_publish` | `{ "pageId": "<uuid>" }` | Publish the saved draft; returns its new immutable revision ID and website URL. |
| `project_update` | Optional `name`, `domain`, `theme` | Change project settings or CSS variables. Publish affected pages to release theme changes. |
| `page_restore` | `{ "pageId": "<uuid>", "revisionId": "<uuid>" }` | Restore an earlier published revision into the draft. Publish separately to replace the live page. |
| `library_list` | `{}` | Built-in component and native LumaFX recipes. |
| `assets_list` | `{}` | Uploaded media available to this project. |
| `asset_upload` | `{ "name": "hero.webp", "mime": "image/webp", "base64": "<file bytes encoded as base64>" }` | Upload supported media, maximum 50 MB decoded; returns its URL. |

The normal sequence is **`pages_list` → `page_get` → `page_upsert` → `preview_url` → `page_publish`**. On a revision conflict, reload the page and reapply the intended change.

`page_upsert` replaces each source field you provide; it is not an element-level patch command. The assistant must preserve the rest of the existing HTML/CSS/JS when changing one element. Omitting a source field leaves it unchanged. Omitting `pageId` creates a new page instead of editing the current one.

## Change the shared blue/dark palette

The dark theme exposes these project-level CSS variables:

```json
{
  "theme": {
    "--site-bg": "#07101d",
    "--site-surface": "#101b2d",
    "--site-card": "#14223a",
    "--site-accent": "#4f8cff",
    "--site-accent-soft": "#a7c8ff",
    "--site-text": "#f5f8ff",
    "--site-muted": "#a4b3c9",
    "--site-border": "#253852"
  }
}
```

Send an updated `theme` object to `project_update`, preview the result, then call `page_publish` for every page that should receive it. Theme CSS is injected after the page stylesheet so these values can override the stylesheet defaults. Include the existing theme entries you want to keep: updating `theme` replaces the project's theme object rather than merging individual entries.

This changes elements that use those variables. Action buttons derive a darker `--site-action` shade from the accent to preserve contrast; you can override that variable too. A custom element with a literal color or its own SVG fill may require an HTML/CSS edit. Project theme changes are saved with published revisions; they do not automatically recolor every existing live revision.

## Change reusable components across the whole site

The marketing source keeps common pieces in these files:

| File | What to change |
| --- | --- |
| `marketing/home.mjs` | Homepage sections and copy. |
| `marketing/pages.mjs` | Product, Campaigns, Automations, Pixel, Inbox, Developers, Pricing, and Resources pages. |
| `marketing/shared.mjs` | Header, footer, shared icons, and page layout; reexports the shared `visual()` function. |
| `marketing/visuals.mjs` | Shared SVG product illustrations and their labels/structure. Change a visual here to update its source wherever it is reused. |
| `marketing/dark-theme.css` | Shared dark/blue palette, surfaces, typography, and style overrides. |
| `marketing/typography.css` | Self-hosted Sora titles, DM Sans subtitles/body, font sizes, and type hierarchy. |
| `marketing/platform-cards.css` | The central product cards, their asymmetric grid, SVG stages, and feature lists. |
| `marketing/art-direction.css` | Current email hero layout, responsive artwork crop, and editorial details. |
| `marketing/visual-scenes.css` | Illustration scene styling and animation rules. |
| `marketing/styles.css` | Base website layouts and responsive styling. |
| `marketing/motion.js` | Menu, page transitions, IntersectionObserver behavior, and motion controls. |
| `marketing/publish.mjs` | Assemble the source and publish the website pages through LumaSite. |

The current hero is `marketing/assets/mail-hero-v2.webp`, with a smaller mobile variant. Its unchanged generated original and full prompt are preserved beside it. Font files and licenses live in `marketing/assets/fonts/`; the publisher uploads them to the project's media storage and replaces the CSS font URLs. Edit `--font-display` and `--font-body` or their typography rules to change the type roles. Font assets can load in both live pages and sandboxed studio previews.

From the `lumasite` directory, publish source changes with:

```sh
node marketing/publish.mjs
```

This updates website drafts and publishes their revisions through the running service. It does not rebuild/redeploy the LumaSite application or restart its process. The script is currently configured for the local `.lumasite` instance and project slug `sendmailos`.

**Shared source components become copies inside each published page. They are not yet globally linked live component instances.** A shared-source change must be published to every page that uses it. An MCP-only change to a repeated element must likewise update each relevant page.

## Keep source and studio edits in sync

Choose the editing workflow deliberately:

- **Studio/MCP:** convenient for changing a saved page directly, previewing it, and publishing that page.
- **Marketing source files:** convenient for coordinated changes to shared navigation, design, and illustrations across all nine pages.

**The bulk publisher uses the marketing files as its source of truth and refuses to replace tracked pages changed through the studio/MCP since its last source publication.** It compares the saved published revision ID and draft revision with `marketing/published.json` before publishing. If either changed, it stops and asks you to synchronize the intended edits into source.

Read the current page, copy the changes you intend to keep into the corresponding marketing source, and review the result. Then reconcile only that page's manifest entry against the freshly read `publishedRevisionId` and `revision`: its `revisionId` records the accepted published revision, and `draftRevision` records the accepted draft revision. Preserve the other records. **Do not delete/reset the manifest or invent revision numbers to bypass the guard.** After source and the accepted baseline agree, rerun the publisher. You can also continue through studio/MCP if you want to keep that editing workflow. The current release does not automatically import saved page edits back into source files.

## Undo a published change

In the studio, open the page's **History**, choose an earlier revision, and select **Restore draft**. Review it, then publish. Restoration does not immediately replace the live page.

MCP uses `page_restore` followed by `preview_url` and `page_publish`. It currently has **no revision-list tool**. Use an earlier `page_publish` result's revision ID, or obtain it from the authorized history API, `GET /api/projects/<projectId>/pages/<pageId>/revisions`. The studio lists that history for you. Restoring also restores the saved page path; a conflicting path must be resolved first.

For media, upload through **Media library** or `asset_upload`, then put the returned URL in the page HTML. SVG product diagrams here are inline page source, rather than uploaded SVG files. Browser JavaScript is editable; adding new server-side functionality still requires an application update.
