# SEO example: from a draft to published search metadata

This example publishes an article for **Example Studio** at `https://example.com/blog/welcome-email-checklist`. It shows the inputs you control, the output LumaSite generates, and the checks needed on your real production host.

![Write, preview and publish an article to generate HTML metadata, structured data, sitemap and RSS](images/seo-publishing.png)

The fixture uses reserved example URLs and original sample copy. Replace its domains, editorial content, dates, and image paths with your own. The example does not deploy `example.com` or submit anything to a search engine.

## What the example contains

| File | Purpose |
| --- | --- |
| [seo-input.json](examples/seo-input.json) | Complete project defaults and an article draft, including its HTML and CSS |
| [seo-head.html](examples/seo-head.html) | Actual generated metadata and JSON-LD, extracted before runtime styles/scripts |
| [sitemap.xml](examples/sitemap.xml) | Three indexable published URLs with lastmod and priorities |
| [robots.txt](examples/robots.txt) | Production crawler directives and sitemap location |
| [feed.xml](examples/feed.xml) | One published article in RSS 2.0 |
| [build-docs-assets.mjs](../scripts/build-docs-assets.mjs) | Regenerate the illustrations and check these outputs in a disposable store |

The timestamps in the committed output are from the example's generation run. `lastmod` is the revision publication timestamp, while `datePublished` comes from the article's editorial publication date.

## 1. Set website defaults

In **Connections → SEO and branding**, configure the shared name, description, language, social image, logo, and favicon. In **Website settings**, set the intended production domain.

The equivalent `project_update` MCP arguments are:

```json
{
  "name": "Example Studio",
  "domain": "example.com",
  "seo": {
    "siteName": "Example Studio",
    "description": "Practical email guides from the Example Studio team.",
    "language": "en",
    "image": "https://example.com/media/social-card.png",
    "imageAlt": "A blue envelope beside the Example Studio wordmark",
    "logo": "https://example.com/media/logo.png",
    "favicon": "https://example.com/media/favicon.png",
    "noindex": false
  }
}
```

Upload real assets through Media library or `asset_upload` and use the returned URLs. Paths above are placeholders, not bundled images. LumaSite writes the social-image tags; it does not generate a new Open Graph image from your title automatically.

Read `project_get` before changing an existing website: `project_update` replaces the supplied `seo` object, so preserve defaults you still need. Shared project SEO takes effect immediately. Per-page SEO is part of its draft and published revision.

## 2. Create an article draft

In **Pages → Settings**, use a path such as `blog/welcome-email-checklist`, select **Blog article**, and set its headline, author organization, publication date, description, and cover image. Keep the visible content consistent with its metadata.

For MCP, pass the `article` object from [seo-input.json](examples/seo-input.json) to **`page_upsert`**. The file contains complete HTML and CSS. Its key settings are:

```json
{
  "title": "A welcome email people want to open | Example Studio",
  "slug": "blog/welcome-email-checklist",
  "description": "Write a useful welcome email with a clear subject, one next step, and a reply address your team reads.",
  "seo": {
    "type": "article",
    "headline": "A welcome email people want to open",
    "author": "Example Studio editorial team",
    "publishedTime": "2026-10-23T08:00:00.000Z",
    "image": "https://example.com/media/welcome-email-cover.png",
    "imageAlt": "An envelope representing a first email to a new subscriber",
    "noindex": false
  }
}
```

This excerpt omits the body and styling for readability. Do not use it to overwrite an existing page's HTML. For an update, first call `page_get`, preserve the fields you want, and include the returned `pageId` and current `revision` in `page_upsert`. The article author field currently emits an `Organization`; it is not a person-profile editor.

## 3. Review, then publish

1. Save with `page_upsert` or **Save draft**.
2. Call `preview_url` with the returned page ID, or use **Open draft** in Studio. The signed preview uses the separate website origin and expires after ten minutes.
3. Review visible content, links, mobile layout, and images. A draft edit does not change an existing published page's metadata or sitemap entry.
4. Call `page_publish` with the page ID, or use **Publish page**. LumaSite compiles Tailwind and stores a published revision without rebuilding or restarting the Studio application.

The preview response carries `noindex,nofollow`. Noindex is an indexing directive, not an access password. A signed URL grants access while valid; keep it with intended reviewers.

## 4. Inspect the generated output

The initial published HTML includes the following tags. They come from the sample's actual renderer output, not a tag list for you to paste into every page:

```html
<title>A welcome email people want to open | Example Studio</title>
<meta name="description" content="Write a useful welcome email with a clear subject, one next step, and a reply address your team reads.">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="https://example.com/blog/welcome-email-checklist">
<meta property="og:type" content="article">
<meta property="og:url" content="https://example.com/blog/welcome-email-checklist">
<meta property="og:image" content="https://example.com/media/welcome-email-cover.png">
<meta name="twitter:card" content="summary_large_image">
```

The [complete output](examples/seo-head.html) also includes the social title/description/image descriptions, article dates, RSS link, favicon, and an `application/ld+json` graph:

| Generated entity | What the example supplies |
| --- | --- |
| `Organization` | Website name, home URL, and logo |
| `WebSite` | Website identity, language, and publisher reference |
| `WebPage` | Canonical article URL, title, description, and website reference |
| `BreadcrumbList` | Home → Blog → Article, derived from the nested path |
| `BlogPosting` | Headline, author organization, publisher, cover image, and dates |

Additional JSON-LD can be entered in page settings, but it must describe the visible content accurately. Do not add fabricated ratings or reviews. Valid markup does not guarantee a rich result. [Google's structured-data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies) describe eligibility and content requirements.

Canonical metadata names the preferred URL; it does not create a redirect. When moving a WordPress site or changing slugs, preserve old URLs or configure the appropriate redirects in your proxy/server. [Google's canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) explains how canonical signals are interpreted.

## 5. Check the sitemap and feed

The fixture publishes a homepage, blog index, and article. It also creates one unpublished draft and one published noindex sample:

| Page | Published? | Noindex? | Sitemap | RSS |
| --- | --- | --- | --- | --- |
| `/` | Yes | No | Yes · priority `1.0` | No; not an article |
| `/blog` | Yes | No | Yes · priority `0.8` | No; not an article |
| `/blog/welcome-email-checklist` | Yes | No | Yes · priority `0.6` | Yes |
| `/unpublished-draft` | No | — | No | No |
| `/samples/example` | Yes | Yes | No | No |

The sitemap lists absolute canonical production URLs and the actual revision's publication time as `lastmod`. Pages canonicalized away from their own normal URL are excluded. The RSS includes up to 100 indexable published articles. The current sitemap is a single file; it does not automatically partition large sites.

Google ignores `priority` and `changefreq`; sitemap submission is a hint rather than a guarantee of crawling or indexing. Google also expects accurate modification dates. See [its sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).

A missing stylesheet warning when viewing XML in a browser is normal. The sitemap is machine-readable XML, not a styled website page. Find its Open/Copy controls in **Quick links** or **Connections → Website links**.

## 6. Make the blog index update automatically

Create a page at `blog` and include:

```html
<main>
  <h1>Email guides</h1>
  <div class="blog-grid"><!-- lumasite:blog-list --></div>
</main>
```

LumaSite renders links, descriptions, dates, and images from published article revisions into this marker. Style `.blog-grid` and `.blog-card` yourself or use the native blog component. Add `<!-- lumasite:blog-related -->` to an article for up to three other articles.

Noindex articles can still appear in a public blog listing. Noindex controls indexing, not visibility or authorization. Unpublished drafts stay out of the listing.

## 7. Verify on the production host

After DNS, HTTPS, and reverse-proxy routing are active, replace `example.com` in these read-only checks:

```sh
curl -I https://example.com/blog/welcome-email-checklist
curl -sS https://example.com/blog/welcome-email-checklist
curl -sS https://example.com/sitemap.xml
curl -sS https://example.com/robots.txt
curl -sS https://example.com/feed.xml
```

Check the article's successful response, expected canonical/title/description, index directive, reachable cover image, working internal links, and matching sitemap/feed entries. Validate eligible structured data with Google's Rich Results Test and submit the production sitemap in your Search Console account. LumaSite does not submit it for you.

Use the real production hostname for this check. `/sites/<slug>/` and signed draft URLs intentionally carry noindex, even when their canonical points to production. Preview robots also disallows crawling. Robots.txt blocking is not a reliable removal tool: a crawler must be able to fetch a page to observe its noindex directive. [Google's noindex documentation](https://developers.google.com/search/docs/crawling-indexing/block-indexing) explains that distinction.

## Reproduce the example locally

From the GitHub development checkout, with development dependencies and Chromium installed:

```sh
npm ci
npx playwright install chromium
node scripts/build-docs-assets.mjs
```

The generator uses a temporary store and deletes it afterward. It renders the diagrams, publishes the example pages using the real service, extracts metadata, and checks sitemap/RSS contents. It also edits a draft's noindex setting and confirms that the previously published sitemap is unchanged. No installed website, credentials, DNS, or production server is modified.

The [SEO reference](seo-and-blog.md) documents all fields and migration behavior. The [comparison](comparison.md) explains how this workflow differs from WordPress, Next.js, and a Vite application. LumaSite supplies technical defaults; content quality, accessibility, image delivery, redirects, site performance, and search-engine decisions still matter.
