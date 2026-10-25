# Upgrade the existing SendMailOS SEO runtime

The production installation observed on 2026-10-25 runs v0.11.0. Page publication
cannot update its server renderer or add public routes. This change requires an
application upgrade followed by explicit adoption of the existing EN/SQ/IT/DE
pages. The repository's CI tests code; it does not deploy to production.

## Preserve the existing installation

Identify the running installation's application directory, private data directory
and process manager first. Use the existing data directory, domains, credentials,
ports and proxy configuration. Do not run the new-project initializer. Keep the
previous application release available for rollback.

Stop the existing runtime through its actual process manager, then take a full
private backup using the existing installation's CLI. For a native checkout:

```sh
node bin/lumasite.mjs stop --data-dir /absolute/existing/private-data
node bin/lumasite.mjs backup \
  --data-dir /absolute/existing/private-data \
  --output /absolute/private-backups/before-server-seo
```

Use the supervisor's stop command instead when it owns the process. Verify the
backup includes state, credentials, uploaded assets and private configuration.
Keep the backup outside the repository and public web roots.

Install the reviewed fix commit into a separate application checkout, with
Node.js 24 or later and `npm ci --omit=dev --ignore-scripts`. Run that checkout
with the original private data directory. Update the supervisor's application
path if needed; retain its other settings. Do not install `lumasite@0.13.0` and
assume it contains this patch: use the reviewed commit or a release that includes
it. The adoption helper below is supplied in this source checkout.

For the native CLI lifecycle, from the new checkout:

```sh
node bin/lumasite.mjs start --data-dir /absolute/existing/private-data
node bin/lumasite.mjs health --data-dir /absolute/existing/private-data
node bin/lumasite.mjs doctor --data-dir /absolute/existing/private-data
```

Use the supervisor's start command when applicable. Confirm the new renderer is
running before migrating metadata. Reconnect MCP so its discovery includes the
language tools and the `languages_update.assignments` input.

## Review and apply the language adoption

Run from the new source checkout as the owner of the private data directory:

```sh
node scripts/adopt-prefixed-pages.mjs \
  --data-dir /absolute/existing/private-data \
  --project sendmailos-live
```

This is a read-only dry run. For the audited production inventory, expect **36
pages in 9 translation groups**: each English page and its SQ/IT/DE equivalents.
Check the printed paths against the current site's intended equivalents before
applying. Changed inventory requires review rather than assuming these counts.

```sh
node scripts/adopt-prefixed-pages.mjs \
  --data-dir /absolute/existing/private-data \
  --project sendmailos-live \
  --apply
```

The helper reads the existing local project token and calls the authenticated
MCP on `127.0.0.1`. It takes a private state snapshot, checks page/language
revisions and adopts the explicit assignments atomically. It preserves URLs,
published content, prior publication history and unrelated pending drafts. It
does not publish the bulk marketing source or change legal-page indexing.

## Verify the production response

Read initial HTTP HTML without executing JavaScript, using a normal browser user
agent. Check all 36 translated-group pages for self canonicals and reciprocal
`en`, `sq`, `it`, `de` and `x-default` alternates. Each non-English page must have
its correct `<html lang>`, matching WebPage `inLanguage`, and `og:locale` of
`sq_AL`, `it_IT` or `de_DE`. Confirm these tags are in the initial document head.

The audit had 109 published pages and, after the three guide-indexing fixes,
99 sitemap URLs. Reconcile with any subsequent authoring changes. The sitemap
must include the 27 translated pages and all six published article URLs, with
translation alternates matching the HTML. The 10 legal-review pages must retain
their intentional noindex and remain outside the sitemap.

Check `https://sendmailos.com/robots.txt` permits the public routes and advertises
the correct sitemap. Check `/llms.txt` returns HTTP 200, UTF-8 `text/plain` and
published links only; `/llm.txt` must return 301 to `/llms.txt`. Preview routes
must remain noindex, and unknown hosts must return 404 for these resources.
The guide does not replace robots rules or guarantee AI/search visibility.

Repeat any failed HTTP request and retain its timestamp, URL, status,
`X-Request-Id` and proxy request identifier. Match Node `public.request` and
`error` logs, plus Apache/Cloudflare logs for failures before Node. The earlier
six HTTP 500 responses recovered on retry; their cause was not established, so
request correlation is diagnostic support, not a claimed root-cause fix.

## Rollback

Stop the runtime before restoring state. Restore the verified full backup and
previous application together, then restart through the existing process manager
and verify health and public responses. A migration state snapshot alone does
not replace the full backup. Never overwrite state under a running process.
