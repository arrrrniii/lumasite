# SendMailOS brand assets

The paper-plane identity extends the dashboard's original indigo favicon. The original PNG is preserved as `dashboard-favicon-reference.png`; its recorded source and the derived asset details are in `brand.json`.

- `sendmailos-mark.svg`: editable vector mark.
- `sendmailos-wordmark-dark.svg` / `sendmailos-wordmark-light.svg`: transparent self-contained wordmarks, including the licensed Sora font.
- Matching transparent PNG wordmarks for applications that do not accept SVG.
- `sendmailos-icon-64.png`, `sendmailos-icon-180.png`, `sendmailos-icon-512.png`: favicon, Apple icon, and organization logo.
- `sendmailos-social-1200x630.png`: default social-sharing image.

These assets use native SVG and Chromium rendering, extending the existing logo system rather than using a raster image-generation model. Font terms are retained in `../fonts/Sora-OFL.txt`. Rebuild with `node scripts/build-brand-assets.mjs` from the LumaSite root.
