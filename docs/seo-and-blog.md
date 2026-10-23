# SEO, blog articles, and brand assets

LumaSite serves metadata and article content in the initial HTML. Search engines do not need the browser script to run. Publishing a page updates its metadata, sitemap entry, blog listing, and RSS content without restarting the application.

For a complete walkthrough with generated HTML, JSON-LD, sitemap, robots, and RSS files, start with [the worked SEO example](seo-example.md). For a sourced feature comparison, see [LumaSite, WordPress, Next.js, and Vite](comparison.md).

## Website defaults

In **Connections → SEO and branding**, set the site name, language, description, default social image, organization logo, favicon, and Apple touch icon. Use uploaded media URLs or absolute HTTP(S) URLs. These shared defaults apply immediately. A site-wide noindex switch is available for staging websites.

The **Production domain** determines automatic canonical URLs. Configure its DNS, HTTPS, and reverse proxy before going live. Project-path URLs under `/sites/<slug>/` remain noindex on the preview origin; on the configured production domain they redirect with 301 to clean paths such as `/pricing`. Navigation links in older ZIP imports adapt automatically from 0.8.1, without republishing. Signed draft previews and the Studio remain noindex. Local `.local` domains also remain noindex. The software does not register domains or submit a site to search engines.

## Page settings

Open a page and select **Settings**. The page title and search description are used by default. Optional controls include:

- SEO title override and canonical URL override.
- Social image and its alternative text.
- A noindex checkbox for a sample or other publicly readable page that should stay out of search results.
- Article type, headline, author organization, and publication/modification times.
- Additional JSON-LD as a JSON object or array, limited to 64 KiB.

Save a draft, preview it, then publish. Page SEO belongs to the revision and is restored with its content. JSON-LD is serialized safely into the document head; it must describe information actually supported by the page. A date needs a timezone, for example `2026-10-22T12:00:00.000Z`.

LumaSite generates `Organization`, `WebSite`, `WebPage`, and page breadcrumbs. Article pages also receive `BlogPosting` with their author, dates, and image when supplied. It emits canonical, Open Graph, Twitter card, language, description, and robots metadata. It does not invent ratings, reviews, addresses, or performance claims.

## Automatic sitemap, robots, and RSS

For a configured production domain:

```text
https://example.com/sitemap.xml
https://example.com/robots.txt
https://example.com/feed.xml
```

Each project has its own resources. Shared preview hosts cannot retrieve an aggregate of every project's pages. The sitemap uses absolute canonical URLs and the actual published revision time for `lastmod`; it excludes drafts, noindex pages, and pages whose canonical points elsewhere. Each URL includes `priority`: `1.0` for the homepage, `0.8` for other top-level pages, and `0.6` for articles or nested pages. These are relative hints within the site; Google ignores `priority` values. `changefreq` is omitted. The RSS feed includes the latest 100 indexable articles.

For local inspection, use `/sites/<slug>/sitemap.xml`, `/sites/<slug>/robots.txt`, or `/sites/<slug>/feed.xml`. These preview resources remain noindex; the sitemap still shows the configured production URLs. A public preview project's robots resource disallows crawling.

Published images can be indexed when requested through their project's production domain. Signed previews and administration responses keep noindex headers. After deployment, verify the actual production headers, canonical URL, sitemap, and image URLs. Submit the production sitemap through your own Search Console account and use Google's Rich Results Test for supported structured data. Metadata and sitemaps support discoverability; they do not guarantee rankings or rich results.

This first implementation returns one XML sitemap. Plan sitemap partitioning before exceeding the protocol's 50,000-URL or 50 MB limits.

## Create a blog through MCP

Blog posts are native pages with nested paths and `seo.type` set to `article`. The existing project MCP endpoint and token can manage them:

```json
{
  "title": "A useful welcome email | Example blog",
  "slug": "blog/a-useful-welcome-email",
  "description": "A practical guide to writing a first message for new subscribers.",
  "html": "<main><article><h1>A useful welcome email</h1><p>Your original article content.</p></article></main>",
  "seo": {
    "type": "article",
    "headline": "A useful welcome email",
    "author": "Example editorial team",
    "publishedTime": "2026-10-22T12:00:00.000Z",
    "image": "/media/project-id/cover.png",
    "imageAlt": "Describe the article image",
    "noindex": false
  }
}
```

Call `page_upsert`, inspect the returned draft with `preview_url`, then call `page_publish`. Supply `pageId` and the latest `revision` to update an existing article. Read current metadata before replacing the `seo` object so you preserve fields you want to keep. `project_update` accepts a `seo` object for the shared defaults.

Put this marker in a blog-index page:

```html
<div class="blog-grid"><!-- lumasite:blog-list --></div>
```

The server fills it with links, descriptions, dates, and cover images from this project's published article revisions. New posts appear automatically after publication. Add `<!-- lumasite:blog-related -->` on an article page to show up to three other articles. These are HTML blocks; use the blog component in the native library or provide your own CSS. Noindex articles can remain visible in the public blog list, while staying out of the sitemap and RSS. Noindex is an indexing setting, not access control.

The SendMailOS example includes a `/blog` index and three editable sample guides. They are explicitly marked as samples and have noindex enabled. Review their content and publication dates, then turn off the article's noindex setting and publish when ready. The source lives in `marketing/blog.mjs`; the shared layout lives in `marketing/blog.css`. The bulk source publisher also tracks shared SEO/domain settings in its local publication report and refuses to overwrite later Studio/MCP changes. Synchronize accepted edits into source and reconcile the known report baseline before running it again.

## ZIP migration and updates

Project SEO defaults, per-page metadata, article data, custom JSON-LD, revision history, and uploaded brand assets are included in project ZIPs. Imports remap uploaded media IDs and internal metadata URLs. A canonical override pointing to the source site's own domain is cleared so it derives from the destination domain. External canonical targets remain external. Use an updated LumaSite destination for archives containing these new metadata fields; earlier archives remain importable.

## SendMailOS logo files

The optional example has a native SVG paper-plane mark and self-contained light/dark wordmarks in `marketing/assets/brand/`. They extend the actual dashboard favicon from `https://dash.sendmailos.com/favicon.ico`. Transparent PNG derivatives, 64/180/512-pixel icons, and a 1200×630 social image are included. The editable SVGs remain the source; no raster generation model was used. Sora's font license is retained in `marketing/assets/fonts/`.

Regenerate the brand derivatives with development dependencies and Chromium installed:

```sh
node scripts/build-brand-assets.mjs
```

The source publisher uploads the PNG derivatives and configures the example project's SEO defaults. Its former local domain `sendmailos.local` becomes `sendmailos.com` as the intended production canonical domain. This changes local configuration only; it does not deploy the site or change the existing production server or DNS.

Primary references: [Google's sitemap guide](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), [canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [article structured data](https://developers.google.com/search/docs/appearance/structured-data/article), and [structured-data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies).
