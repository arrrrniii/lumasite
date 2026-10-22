# Self-hosted SendMailOS type

The website uses two families: Sora for titles and DM Sans for subtitles, body text, navigation, and controls. Code examples retain the system monospace stack.

The included normal-style Latin variable WOFF2 files were downloaded unchanged from the official Google Fonts CDN on 2026-10-22. Visitors load these files from the website’s own LumaSite media storage; there is no runtime connection to Google Fonts or another font service.

| Local file | Family | Variable axes requested | Official distribution |
| --- | --- | --- | --- |
| `soravariable.woff2` | Sora | Weight 100–800 | [Google Fonts WOFF2](https://fonts.gstatic.com/s/sora/v17/xMQbuFFYT72XzQUpDqW1KX4.woff2) |
| `dmsansvariable.woff2` | DM Sans | Weight 100–1000; optical sizing 9–40 | [Google Fonts WOFF2](https://fonts.gstatic.com/s/dmsans/v17/rP2Hp2ywxg089UriCZOIHTWEBlw.woff2) |

Both fonts are licensed under the **SIL Open Font License, Version 1.1**. Their copyright notices and complete licenses are retained as `Sora-OFL.txt` and `DMSans-OFL.txt`. Keep these files with redistributed copies of the fonts.

Primary license sources:

- [Sora license in Google Fonts](https://github.com/google/fonts/blob/main/ofl/sora/OFL.txt)
- [DM Sans license in Google Fonts](https://github.com/google/fonts/blob/main/ofl/dmsans/OFL.txt)
- [Sora upstream source](https://github.com/sora-xor/sora-font)
- [DM Sans upstream source](https://github.com/googlefonts/dm-fonts)

The files’ original URLs, sizes, and SHA-256 hashes are recorded in `provenance.json`. Google Fonts versioned both CDN paths as `v17` when downloaded. The distribution stylesheet was requested from:

```text
https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,100..1000&family=Sora:wght@100..800&display=swap
```

`marketing/typography.css` declares both families using `font-display: swap` and the official Latin Unicode range. Its asset placeholders `__SORA_FONT__` and `__DM_SANS_FONT__` are replaced by the publisher after media upload. The editable `--font-display` and `--font-body` properties control the website’s typography without changing the type rules.
