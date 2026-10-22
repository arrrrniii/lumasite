# Native LumaFX integration

LumaSite vendors the user's own [LumaFX](https://github.com/arrrrniii/lumafx), version **0.5.0**, pinned at commit **`f6f3508b0cba10d97a2a00d78eeef36843cd1b85`**. This uses the actual browser distribution, rather than a lookalike or a CDN dependency.

## Files and attribution

`vendor/lumafx/` contains these unmodified upstream files:

- `lumafx.css`: the effect/component stylesheet.
- `lumafx.global.js`: the browser runtime, with all effects registered.
- `effects.json`: the upstream machine-readable catalog of 52 effects and their options.
- `LICENSE`: MIT license, Copyright (c) 2026 Arnold Kajolli.

`manifest.json` adds LumaSite integration metadata and 20 complete, editable example recipes. It records the version, pinned commit and SHA-256 of each vendored upstream file. `NOTICE.md` preserves attribution. No LumaFX source build or package installation is needed for this distribution.

The core browser distribution has no runtime dependencies. React, WordPress, the LumaFX MCP server, the intelligent-UI extension and the editor extension are not required for the effects used here. Those optional upstream modules are not bundled in this first release.

## Runtime loading

Public previews and published pages use the local runtime routes:

```html
<link rel="stylesheet" href="/runtime/lumafx/lumafx.css">
<script src="/runtime/lumafx/lumafx.global.js"></script>
```

The upstream script publishes `window.lumafx`, registers its effects and starts automatically. Upstream recommends loading it in the head without `defer` to mark reveal states before first paint and avoid an entrance-animation flash. With a manual integration, `data-fx-manual` on the script opts out of auto-start; then call `lumafx.start()` explicitly.

LumaSite's page renderer supplies the two runtime tags. Authors using the built-in runtime do not need to copy those tags into every page. The animation library's snippets only contain native HTML attributes and optional page styling/scripts.

## Native authoring examples

```html
<h1 data-fx="text-reveal" data-fx-split="words" data-fx-style="flip">
  Your next chapter starts here.
</h1>

<article data-fx="border-beam" data-fx-duration="5s"
         data-fx-color="#8b5cf6" data-fx-color-2="#22d3ee">
  <h2>Designed to move.</h2>
</article>

<article data-fx="tilt spotlight">
  <h2 data-fx-depth="40">A new perspective.</h2>
</article>

<button type="button" data-fx="press" data-fx-style="burst">
  Try a little motion
</button>
```

Several effect names can share `data-fx`. Options retain upstream spelling. Colors and timing are attributes or the documented LumaFX CSS variables, not invented framework options. `data-fx-off` disables effects in a subtree. Test substantial motion with `prefers-reduced-motion` enabled; LumaFX includes reduced-motion handling, but the whole page and any author JavaScript still need checking.

The MCP/admin library offers curated recipes for text reveal, border beam, scroll reveal, stagger, tilt, spotlight, magnetic links, aurora, glass, shimmer, shine, counter, button press, rotating words, typewriter, SVG draw, modal, drawer, hover icon and dot field. The complete upstream `effects.json` remains available to inspect options for all 52 effects. “20 recipes” and “52 catalog effects” are different counts.

Modal/drawer examples use fixed example IDs. If inserting a second copy, give its dialog a new ID and change `data-fx-open` to match. A form animation does not create a backend endpoint. A counter recipe contains illustrative data, which must be replaced by a verified product metric.

## JavaScript API

Native LumaFX APIs remain available in page JavaScript:

```js
// Usually unnecessary: the runtime observes inserted markup automatically.
window.lumafx.mount(document.querySelector('#new-section'));

// Inspect mounted effects during local development.
console.log(window.lumafx.stats());

// Open a native LumaFX modal from a custom action.
window.lumafx.modals.open('#join', { from: document.querySelector('#join-button') });
```

Other exported runtime methods include `start`, `stop`, `refresh`, `register`, `transition`, `page.cover`, `page.reveal` and `loading`. Browser-ready page JavaScript is stored as part of a page revision; publishing changes it without rebuilding the Node application. JSX, TypeScript and npm packages that require bundling are not executed directly by browsers.

## Tailwind

LumaSite's initial recipes combine ordinary Tailwind classes with native `data-fx` attributes. LumaFX's own CSS is served directly and therefore does not depend on generating `fx-*` utilities. Ordinary Tailwind classes in the page are compiled by the publishing pipeline.

Upstream also offers `lumafx/tailwind.css` for Tailwind v4. It is not vendored here: the native attribute API already covers the first integration. Do not assume arbitrary `fx-*` utility classes will be generated until the compiler explicitly imports that optional file.

## Updating the vendor copy

1. Review and choose a new upstream version/commit.
2. Copy its matching browser distribution, catalog and license as a set.
3. Update `manifest.json` version/commit, hashes and recipes if APIs changed.
4. Verify HTTP delivery, MIME types, reduced motion and at least a text entrance, pointer interaction and modal in the local public preview.
5. Publish a test page and confirm its behavior is consistent with the preview.

The first local integration tests should check the runtime can be fetched and the manifest/catalog remain coherent. A browser check is needed to establish that effects actually mount; file presence alone does not prove animation behavior.

Upstream references: [README at the pinned commit](https://github.com/arrrrniii/lumafx/blob/f6f3508b0cba10d97a2a00d78eeef36843cd1b85/README.md), [global script entry](https://github.com/arrrrniii/lumafx/blob/f6f3508b0cba10d97a2a00d78eeef36843cd1b85/src/global.ts), [runtime exports](https://github.com/arrrrniii/lumafx/blob/f6f3508b0cba10d97a2a00d78eeef36843cd1b85/src/index.ts) and [live examples](https://arrrrniii.github.io/lumafx/).
