# SendMailOS marketing website

Original multipage website published into the local LumaSite SendMailOS project. The layout follows the supplied reference's rounded photography and editorial composition. The current visual direction uses dark navy surfaces, blue accents, and editable animated SVG product illustrations.

The homepage uses original cobalt-blue email artwork: satin metal, smoked glass, and subtle signal ribbons on dark navy. Five matching feature artworks illustrate campaigns, editable templates, workflows, Pixel audiences, and reply conversations; campaign and inbox artwork recur in the relevant cards. A sixth image frames the final invitation with an empty center for its headline. Titles use self-hosted **Sora**; subtitles, navigation, and body copy use self-hosted **DM Sans**. Both variable fonts and their OFL licenses are in `assets/fonts/`. The central product cards keep clear categories and concise feature lists.

## Source

- `home.mjs`: homepage content and feature sections.
- `pages.mjs`: product, campaigns, automations, Pixel, Inbox, developers, pricing, resources.
- `blog.mjs` / `blog.css`: the automatic blog index, three editable noindex sample articles, and responsive reading layouts.
- `assets/brand/`: favicon-based vector logos, PNG icons, and the default social-sharing image.
- `shared.mjs`: navigation, footer, page shell, and the shared illustration export.
- `visuals.mjs`: six original inline SVG product illustrations, including their labels and accessible descriptions.
- `styles.css`: shared responsive styling and transition states.
- `dark-theme.css`: dark/blue skin with shared `--site-*` color variables.
- `typography.css`: font faces and the title/subtitle/body hierarchy.
- `platform-cards.css`: the central four-card product section.
- `section-art.css`: responsive editorial/product image panels and the final image background with its readability overlay.
- `art-direction.css`: hero artwork composition, mobile crop, and editorial refinements.
- `effects.mjs` / `effects.css`: native LumaFX squircles, H2 shimmer, and warm `#ffb547` spotlights on large cards. Headings and page content appear without entrance effects. Shared page assembly applies the editable HTML attributes before publishing.
- `visual-scenes.css`: responsive illustration styles and motion.
- `motion.js`: accessible navigation plus illustration visibility and reduced-motion controls.
- `navigation.css`: page content appears immediately, without arrival fades or heading intros. Links use ordinary browser navigation. The browser script prefetches known public destinations on hover/focus/touch intent, respecting data-saving and slow-connection preferences.
- `assets/`: original generated photographs, compressed delivery files, and prompt provenance.
- `assets/mail-hero-v3*`: the current generated email hero, optimized desktop/mobile delivery files, and full built-in imagegen prompt/provenance.
- `assets/section-art-generation.json`: all six built-in imagegen prompts, original file paths, dimensions, and optimized variants. Card images have 1200px and 640px WebP sources; the closing background has full-width and mobile sources. Originals remain PNGs.
- `assets/fonts/`: self-hosted font binaries, licenses, and official-source provenance.

Feature claims were checked against the real dashboard, API, documentation and plan migrations. See [the evidence audit](../docs/marketing-feature-evidence.md). Illustrations show example content, rather than customer results or testimonials. Only the confirmed Free price is advertised; paid plans link to the dashboard's current catalogue.

## Publish changes

With the local LumaSite instance running, execute from `lumasite`:

```sh
node marketing/publish.mjs
```

The script reads private credentials locally, uploads versioned image assets, saves changed page sources, and publishes immutable revisions through the authenticated live API. It reuses unchanged images and pages and confirms that the runtime PID stays the same. It refuses to overwrite studio/MCP page revisions changed after the last source publication; synchronize those edits first. It does not restart or redeploy the engine. `published.json` contains public asset paths and page revision IDs, with no credentials.

Set `LUMASITE_DATA_DIR` for a production data directory and `LUMASITE_MARKETING_URL_MODE=domain` for clean custom-domain links. The default `project` mode keeps `/sites/sendmailos/` preview links. `LUMASITE_MARKETING_API` overrides the local API origin when needed. The running server deduplicates identical published CSS/JavaScript through content-hashed immutable URLs so destinations can reuse the same browser cache.

These same HTML, CSS, and browser JavaScript sources can also be edited through the LumaSite studio or project MCP tools. The published pages use the native, self-hosted LumaFX runtime for decorative and button effects. Navigation remains ordinary HTML when JavaScript is disabled; enhancements respect reduced motion and browser back navigation.

See [editing elements, colors, and animations](../docs/edit-marketing-elements.md) for the exact studio and MCP workflows. Generated card images are illustrative brand artwork, not screenshots or customer results. They load lazily with responsive source sizes and meaningful alternative text. The closing background is decorative and has empty alternative text. The three explanatory SVG illustrations lower on the homepage and the secondary-page diagrams animate only when in view, pause when the document is hidden, and respect reduced motion. The hero is a responsive image; it has no video download or playback controls. Earlier image/video experiments remain in the source assets for reference and are not loaded by the published pages.

## Browser verification

```sh
node tests/marketing-browser.mjs
```

The browser check uses `http://localhost:4311/sites/sendmailos/` by default. Set `MARKETING_BASE_URL` to check another accessible origin. It checks published pages, mobile navigation, reduced motion, no-JavaScript fallbacks, image loading, layout overflow, and browser errors. Screenshots are saved in `test-results/`.
