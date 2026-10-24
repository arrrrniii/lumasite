# Languages, translations and menus through MCP

Available from **LumaSite 0.13.0**. Every language, page translation, translated header/footer and menu operation is available through the project's existing authenticated MCP connection. Studio is optional; it also exposes page language/key fields. Website code is rendered on the server. No client router, rebuild, application restart or separate project per language is needed for content publication.

## URLs and the content model

| Translation key | English (default) | Shqip | Italiano |
| --- | --- | --- | --- |
| `home` | `/` | `/sq/` | `/it/` |
| `pricing` | `/pricing` | `/sq/cmimet` | `/it/prezzi` |
| `welcome` | `/blog/welcome` | `/sq/blog/miresevini` | `/it/blog/benvenuto` |

The default language retains root paths. Other languages use their lowercase language code as a prefix, including regional codes such as `/en-gb/`. Each page has independent content, title, description, SEO settings, publication and revision history. The shared `translationKey` connects equivalent pages; `locale` identifies their language. Changing language does not perform machine translation: supply the translated content through MCP.

Legacy websites keep their existing URLs and single-language behavior until configured. Configure languages before creating translations. Settings reject duplicate languages, invalid codes, stale revisions and changes incompatible with existing drafts, live pages or menus. URL paths use lowercase Latin letters, digits, hyphens and slashes; page text can use any language. Language homepages are stored with paths such as `sq`, served at `/sq/`, and canonicalized with the trailing slash.

## Tools

| Tool | Purpose |
| --- | --- |
| `languages_get` | Read languages, current revision, prefixes and all page assignments |
| `languages_update` | Configure default language, languages, labels, text direction and blog link labels |
| `translations_list` | Read groups, missing draft/live languages, page IDs and revisions |
| `translation_upsert` | Create/update a translation using its language-relative path |
| `translation_delete` | Delete one translation with exact path/revision confirmation and a recovery ZIP |
| `menus_get` | Read localized menu drafts and their live snapshot |
| `menu_upsert` | Save one menu key/language; other menus are preserved |
| `menu_remove` | Remove one menu from the draft |
| `menus_publish` | Publish all saved menus atomically |
| `page_get`, `page_upsert`, `page_publish`, `page_restore` | Read, edit, publish and restore page versions |
| `layout_get`, `layout_update`, `layout_publish`, `layout_restore` | Manage shared and translated header/footer source and shared CSS/JS |

Use the revisions returned by the read tools instead of assuming the numbers in these fresh-project examples. Changes are confined to the MCP connection's project. All 32 MCP tools retain the existing project/OAuth authentication.

## 1. Enable languages

Call `languages_get`, then `languages_update`:

```json
{
  "expectedRevision": 0,
  "defaultLocale": "en",
  "locales": [
    { "code": "en", "label": "English", "direction": "ltr" },
    { "code": "sq", "label": "Shqip", "direction": "ltr", "readMoreLabel": "Lexo artikullin" },
    { "code": "it", "label": "Italiano", "direction": "ltr", "readMoreLabel": "Leggi l’articolo" }
  ]
}
```

Language configuration applies immediately; it neither publishes drafts nor translates existing text. `direction: "rtl"` enables right-to-left document layout for languages such as Arabic. Shared SEO language follows the configured default language.

## 2. Link an existing page without changing its URL

Read the existing page and call `translation_upsert` with its actual ID and revision:

```json
{
  "pageId": "EXISTING-PRICING-PAGE-UUID",
  "revision": 3,
  "locale": "en",
  "translationKey": "pricing",
  "path": "pricing"
}
```

Omitted content is preserved. Use `path: ""` to assign the existing homepage. `path` is relative to the language, so do not put `sq/` in an Albanian translation's `path`. The returned page's `slug` is the full route. `page_upsert` also accepts `locale` and `translationKey`, but its `slug` must already include the correct prefix. To unlink a page, clear both fields with null and use a valid default-language path.

Publish the assignment with `page_publish` before expecting it in public navigation or SEO. Saved assignments remain drafts. Restoring a page restores its language/key metadata along with its source and SEO; publication is separate.

## 3. Create its translated version

Call `translation_upsert`:

```json
{
  "locale": "sq",
  "translationKey": "pricing",
  "path": "cmimet",
  "title": "Çmimet",
  "description": "Zgjidh planin e duhur për email-et e tua.",
  "html": "<main><h1>Çmimet</h1><p>Planet tona.</p></main>",
  "layoutMode": "global"
}
```

This saves `/sq/cmimet`. `layoutMode: "global"` needs a published global layout before publishing the page. Publish the returned ID through `page_publish`. To update it later, read `page_get` or `translations_list` and supply the latest `revision`. Two different pages cannot claim the same language/key in either draft or live content.

## 4. Publish translated menus

After `menus_get`, call `menu_upsert` for each language:

```json
{
  "key": "primary",
  "locale": "sq",
  "label": "Menuja kryesore",
  "expectedRevision": 0,
  "items": [
    { "label": "Kryefaqja", "translationKey": "home" },
    { "label": "Çmimet", "translationKey": "pricing" },
    { "label": "Hyr", "href": "https://dash.example.com/" }
  ]
}
```

Use the new navigation revision for each subsequent edit. Call `menus_publish` with the latest `expectedRevision` to update the live menus. `menu_remove` only changes the draft until this publication. Items support nested `children` up to three levels. Each item must contain exactly one `translationKey` or `href`. Labels are escaped; script URLs and protocol-relative destinations are rejected.

Reference pages by `translationKey` so the server resolves the correct published slug. Missing or unpublished translations are omitted, avoiding invented links. A menu is only shown in its own language; another language's menu is not silently substituted.

## 5. Put menu and switcher slots in the layout

Read `layout_get`, then save through `layout_update` and publish with `layout_publish`:

```html
<header class="site-header">
  <a href="/">Your brand</a>
  <!-- lumasite:menu:primary -->
  <!-- lumasite:languages -->
</header>
```

The menu slot produces a `nav.ls-menu.ls-menu-primary` with lists/anchors. The switcher produces `nav.ls-languages`. Style those classes in shared layout CSS. Current page/language links use `aria-current="page"`; language links use `lang` and `hreflang`. The switcher stays on the equivalent page and only links published variants. A page without a translation key has no language switcher.

For other translated header/footer text, pass an optional `locales` map to `layout_update`:

```json
{
  "expectedRevision": 1,
  "locales": {
    "sq": {
      "header": "<header><!-- lumasite:menu:primary --><!-- lumasite:languages --><a href='/contact'>Na kontakto</a></header>",
      "footer": "<footer>Na kontakto · {{page.locale}}</footer>"
    },
    "it": { "footer": "<footer>Contattaci</footer>" }
  }
}
```

Use canonical locale keys, such as `en-GB`. Omitted localized header/footer fields fall back to the base layout. CSS and JavaScript remain shared, and Tailwind compilation includes classes from every translated header/footer. The locales map replaces the previous map when supplied; read it before updating. Omitted maps are preserved. Shared source supports `{{page.title}}`, `{{page.slug}}`, `{{page.layoutClass}}` and `{{page.locale}}`.

Ordinary same-website anchor links to linked published pages also resolve to the current language, preserving queries/fragments. External, fragment-only and unrecognized links stay as authored. If a normal link has no translated equivalent, its authored destination stays; key-based menu items with no translated destination are hidden. Scripts and templates are preserved. In signed previews the current draft and draft menus/layout can be inspected, while other unpublished pages remain private; links to published pages retain the `/sites/<project>/` preview prefix.

## SEO, blog and RSS

- Document `lang`/`dir`, Open Graph locale and JSON-LD reflect the rendered page's language.
- Each version has its own canonical URL, title, description and social image.
- Reciprocal `hreflang` sets list published, indexable, self-canonical equivalents including the current version. `x-default` points to that group's default-language version if available. Drafts, noindex versions and custom-canonical aliases are excluded.
- The root `/sitemap.xml` includes all indexable language versions, with matching `xhtml:link` alternates. Language homepages keep homepage priority; language prefixes are excluded from breadcrumb levels. Priority remains advisory and does not improve rankings.
- Blog lists/related articles filter by the current language. The default language uses `/feed.xml`; other languages use `/sq/feed.xml`, `/it/feed.xml`, etc. Configure `readMoreLabel` for localized article links.
- Preview URLs remain noindex and never receive production integration tags.

The implementation follows [Google's localized-page guidance](https://developers.google.com/search/docs/specialty/international/localized-versions). It does not guarantee indexing or rankings and does not auto-redirect visitors based on browser language.

## Remove a translation or language

Call `page_get`, then `translation_delete` with `pageId`, its latest `expectedRevision`, and its exact current draft path as `confirmPath` (for example `/sq/cmimet`, or `/` for the root). This removes that page's draft, published route and revision history. A private full-website recovery ZIP is saved first; the tool returns its authenticated download path. Other language versions and media remain. Reference-based navigation and SEO stop advertising the deleted version immediately. Existing manually authored links may need editing; add redirects separately if retiring indexed URLs.

To remove a language, first remove its translations and its menus, then publish the menu removal. `languages_update` refuses a language still referenced by current drafts, live pages or draft/published menus. Historical ZIPs/layout overrides may still contain old language text; they are not silently deleted.

## Transfer and upgrade

ZIP export/import includes languages, page assignments, localized menus and layout variants. New imports remap media/project links and preserve which translations and menu/layout versions are live. Existing older ZIPs remain supported. Updating an existing website replaces these settings with those in its ZIP, following normal recovery/identity preservation rules. Older runtimes cannot import new multilingual fields: upgrade the destination first.

For generated installations, make a private backup, stop via the process supervisor, install `lumasite@0.13.0` and restart with the same data directory. See [the tested upgrade commands](install-from-github.md#update-the-application). Publishing npm packages does not itself upgrade a running website. Refresh/reconnect your MCP client's tool discovery after upgrading the server; the endpoint URL stays the same.
