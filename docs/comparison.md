# Compare LumaSite, WordPress, Next.js, and Vite

This compares the **LumaSite v0.5 workflow** with conventional self-hosted WordPress, the Next.js App Router, and a plain Vite application. Documentation was checked on **October 23, 2026**. A CMS, an application framework, and a frontend build tool solve different parts of a website, so this is a choice-of-workflow guide rather than a winner table.

LumaSite's behavior is backed by this repository's implementation and checks. Other columns describe their documented building blocks; particular themes, plugins, CMS integrations, and hosting choices can change the result. There are no comparative performance measurements or ranking guarantees here.

## Editing and publishing

| Need | LumaSite v0.5 | WordPress | Next.js App Router | Plain Vite application |
| --- | --- | --- | --- | --- |
| Starting point | Self-hosted Studio, CLI, publishing service, and project MCP | Content management system with themes and plugins | React application framework | Frontend development/build tool |
| Create a marketing page | Author editable HTML, CSS, Tailwind, and browser JS in Studio/MCP | Use blocks, a theme, or a builder | Build page components and connect a content source as needed | Build frontend routes/components and choose content infrastructure |
| Change content without a full application deployment | Save and publish a stored page revision | Normal database-backed editorial workflow | Possible with dynamic data and revalidation; depends on the app | Requires a runtime data source or another integration beyond static build output |
| Change the page's stored structure/styles/browser JS | Publish the updated page source; no Studio redeploy | Editing options depend on the theme/builder; theme/plugin code has its own update path | Data-driven layouts/styles are possible; application source changes have their deployment path | Changes to bundled source normally require a new production build |
| Agent authoring | Project-scoped Streamable HTTP MCP and native publication tools | Integration-dependent | Integration-dependent | Integration-dependent |
| Media and blog workflow | Local media, native article pages, blog-list blocks, RSS | Established content and media workflows | Choose or implement CMS/storage/editorial tools | Choose or implement CMS/storage/editorial tools |
| Runtime administration | CLI for health, ports, logs, restart/stop, backup, and proxy generation | Host/CMS management tools vary | Hosting/process management varies | Hosting/process management varies |

WordPress themes choose how server-rendered templates are assembled; see its [template hierarchy](https://developer.wordpress.org/themes/basics/template-hierarchy/). Next.js documents [dynamic data caching and revalidation](https://nextjs.org/docs/app/getting-started/caching-and-revalidating); it is inaccurate to say every content edit requires a complete rebuild. Vite documents [production builds](https://vite.dev/guide/build) and an [SSR integration API](https://vite.dev/guide/ssr); it is not a CMS or publishing dashboard by itself.

## Technical SEO

All four can support a search-friendly website. The differences below concern what is already assembled and what the site developer must configure.

| Capability | LumaSite v0.5 | WordPress | Next.js App Router | Plain Vite application |
| --- | --- | --- | --- | --- |
| Page title, description, canonical, social tags | Generated from Studio/MCP page fields and website defaults | Theme/plugin configuration supplies the chosen controls | Metadata API configured in application code | Add tags and route-aware rendering/prerendering through the chosen integration |
| HTML article content | Served in the initial response from the published revision | Rendered by the active theme | Static/server rendering options are part of the framework | SSR/prerendering requires an integration; a client application is another possible setup |
| XML sitemap | Automatic published/indexable canonical-page selection | XML sitemap functionality is in core | `sitemap.xml` / `sitemap.ts` file convention; implement the URL source | Implement or add a generator/integration |
| Robots directives | Production and preview behavior generated per project | CMS/host/theme/plugin settings influence the result | `robots.txt` / `robots.ts` file convention | Configure static files or runtime handling |
| JSON-LD | Built-in website/page/breadcrumb/article graph; optional additional JSON | Theme/plugin/custom output | Application-defined structured data | Application-defined structured data |
| Blog and RSS | Built-in article pages, listing markers, and RSS generation | Native content/feed workflows | Implement or connect to an editorial source | Implement or connect to an editorial source |
| Search performance | No comparative score or ranking guarantee | Depends on the website and hosting | Depends on the website and hosting | Depends on the website and hosting |

WordPress [ships XML sitemap functionality](https://make.wordpress.org/core/2020/07/22/new-xml-sitemaps-functionality-in-wordpress-5-5/). Next.js provides [metadata APIs and metadata files](https://nextjs.org/docs/app/getting-started/metadata-and-og-images), including [sitemap generation](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap). Vite provides [SSR building blocks](https://vite.dev/guide/ssr). LumaSite's narrower advantage for this use case is an already connected editing → preview → publish → SEO-resource workflow; these fundamental web capabilities are not exclusive to it.

## What “no application redeploy” means here

In LumaSite, page HTML, Tailwind classes, CSS, browser-ready JavaScript, metadata, and media are stored as website data. Publishing compiles the page's required Tailwind styles and creates a published revision. Visitors receive that revision while you continue editing the next draft.

Changing the Studio itself, server logic, installed dependencies, TypeScript/JSX compilation, or a bundler-specific module still requires an application update. This release does not run arbitrary project build pipelines. Likewise, WordPress can update content without redeploying its PHP application, and Next.js can use runtime content and revalidation. The distinguishing choice is how much of that authoring/publication workflow you want preassembled.

## Where LumaSite is a good fit

| Situation | Consider |
| --- | --- |
| Marketing sites or blogs authored through MCP, with direct control of page HTML/CSS/JS | LumaSite's native workflow |
| One operator managing several domains on an existing Apache/Caddy server | LumaSite's shared two-listener installation, with reviewed virtual-host configuration |
| A publishing team that already relies on familiar themes, plugins, or specialized editorial tools | WordPress and its established ecosystem |
| A custom React product with application-specific data, components, and interactions | Next.js with the CMS/editor that suits the product |
| A custom frontend where you want to choose the routing, rendering, and backend stack | Vite and the appropriate integrations |

These are product-fit judgments, not measurements. Teams can combine approaches, such as Next.js with a headless CMS.

## Current LumaSite limits to account for

- The product is early and its ecosystem is small. It does not provide the breadth of WordPress plugins, payments, or ecommerce workflows.
- Native article authors are organizations. Advanced editorial roles, review workflows, and multilingual hreflang management are not provided by this release.
- The sitemap is one XML file. Automatic sitemap partitioning and specialized news/video/image sitemap extensions are not implemented.
- Canonical metadata does not create HTTP redirects. There is no built-in redirect-management UI; migration redirects belong in your server/proxy configuration or additional application work.
- Media uploads retain originals. There is no video transcoding or automatic responsive-image delivery service, and no built-in Core Web Vitals dashboard.
- The wizard generates proxy configuration. DNS, HTTPS, server updates, and supervised startup remain part of operating your server.

See the [worked SEO example](seo-example.md), [wizard walkthrough](wizard-walkthrough.md), and [Studio guide](studio.md). The earlier [Sitewright review](sitewright-comparison.md) is a separate source-pinned comparison; do not read it as a claim about Sitewright's current release.
