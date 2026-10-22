# SendMailOS marketing feature evidence

Source audit: 22 October 2026. Read-only inspection of the real customer dashboard, current docs, Go API, and versioned plan configuration. No live database, customer records, environment files, or secrets were accessed. No claims are taken from `Content.txt`, old blog copy, demo testimonials, or screenshots of invented results.

The plan catalogue is stored in the database and can be edited by an administrator. Numbers below are the latest checked-in public-plan baseline, not a read of today's production catalogue. The runtime deliberately reads the canonical plan row: `apps/web/services/subscription-service.ts:28`, `:55`, `:689`.

## Safe core positioning

“Campaigns, transactional email, automations, audience insights, and customer replies in one workspace.”

“Start with 3,000 emails a month, free.” This is a monthly hosted-send allowance, not 3,000 emails/day, a one-time trial, or unlimited sending. Each hosted recipient consumes a credit. See the limits below before describing what is included.

## Correct destinations

| Purpose | Destination | Evidence |
| --- | --- | --- |
| Start free / create an account | `https://dash.sendmailos.com/login` | Unified login: `apps/web/app/login/page.tsx`; first magic-link sign-in provisions user and organization in `apps/web/app/api/auth/magic-link/verify/route.ts:9`, `:31`, `:56`. No separate `/signup` route exists. |
| Sign in | `https://dash.sendmailos.com/login` | Google and email magic-link entry points in `apps/web/app/login/page.tsx`, `apps/web/app/login/magic-link-form.tsx`. Dashboard origin in `apps/web/config/site.ts:4`. |
| Dashboard | `https://dash.sendmailos.com/` | `apps/web/config/site.ts`; protected app pages redirect unauthenticated users to `/login`. |
| Documentation | `https://docs.sendmailos.com/` | `apps/web/app/(app)/api-keys/api-keys-client.tsx:256`; docs root is `/` in `apps/docs/lib/shared.ts:2`. |
| API quickstart | `https://docs.sendmailos.com/quickstart` | `apps/docs/content/docs/quickstart.mdx`. |
| API base | `https://api.sendmailos.com/v1` | `apps/docs/content/docs/index.mdx:13`; `apps/api-v2-go/internal/app/router.go`. |
| Template MCP endpoint | `https://dash.sendmailos.com/api/mcp` | `apps/docs/content/docs/guides/mcp-template-studio.mdx:15`; `apps/web/app/api/mcp/route.ts`. This is an OAuth connection endpoint, not an ordinary webpage. |
| MCP connection guide | `https://docs.sendmailos.com/guides/mcp-template-studio` | Same guide; dashboard connection UI links directly to it. |
| SMTP guide | `https://docs.sendmailos.com/guides/smtp` | `apps/docs/content/docs/guides/smtp.mdx`. |
| Inbox / receiving guide | `https://docs.sendmailos.com/guides/conversations` | `apps/docs/content/docs/guides/conversations.mdx`. |
| Verified webhook guide | `https://docs.sendmailos.com/guides/webhooks` | `apps/docs/content/docs/guides/webhooks.mdx`. |

There is no verified public sales email or legal-policy URL established by this audit. Do not invent `hello@`, support contacts, privacy-policy documents, or sales promises. A support@example.com placeholder in the app is not a real marketing contact.

## Public-plan baseline

The main catalogue is `supabase/migrations/20260825012335_professional_plan_entitlements.sql:38–151`. The later `supabase/migrations/20260825103904_automation_allowances.sql:38–73` overrides workflow counts for Growth/Pro and adds execution/step allowances. Currency is EUR: `apps/web/lib/billing-currency.ts:1`.

| Allowance | Free | Starter | Growth | Pro |
| --- | ---: | ---: | ---: | ---: |
| Monthly price | €0 | €12 | €39 | €99 |
| Annual total | €0 | €108 | €348 | €948 |
| Monthly equivalent when billed annually | €0 | €9 | €29 | €79 |
| Hosted emails / month | 3,000 | 25,000 | 100,000 | 250,000 |
| Subscribed contacts | 2,000 | 10,000 | 50,000 | 250,000 |
| Sending domains | 1 | 3 | 10 | 50 |
| Pixels | 1 | 3 | 10 | 50 |
| Saved workflows | 3 | 10 | 30 | 100 |
| Automation executions / month | 1,000 | 10,000 | 100,000 | 500,000 |
| Automation steps / month | 10,000 | 100,000 | 1,000,000 | 5,000,000 |
| Templates | 10 | 50 | 250 | 1,000 |
| Webhooks | 2 | 10 | 25 | 100 |
| Team members | 1 | 3 | 10 | 25 |
| API requests / day | 1,000 | 25,000 | 100,000 | 1,000,000 |
| Log retention | 7 days | 30 days | 90 days | 365 days |
| Connected sending servers | Unavailable | 1 | 3 | 10 |

Free has API access enabled. Connected sending servers explicitly require Starter or higher (`apps/web/app/(app)/servers/page.tsx:64`); zero `servers_limit` on Free does not mean unlimited access because `servers_access=false`.

Subscriber usage counts `status='subscribed'`, not every historical/unsubscribed record: `apps/web/services/subscription-service.ts:314`. Additions/imports and API creation enforce subscriber limits (`apps/web/app/actions.ts:167`, `:349`; `apps/api-v2-go/internal/service/plan_limits.go`). Do not claim unlimited contacts or unlimited subscriber storage on the Free plan.

Email windows are monthly. Active annual/long-lived Free subscriptions use monthly windows anchored to subscription start; an organization without a usable subscription anchor uses a UTC calendar month. Avoid promising that every customer resets on the first of the month. Evidence: `supabase/migrations/20260904103538_align_email_credits_with_subscription_periods.sql:31–115` and `packages/queue/src/credits.ts:204`.

The catalogue sets white-label, dedicated IP availability, priority support, dedicated support, and custom reporting flags to false. Do not present these as included paid-plan perks without a separate verified change. Enterprise is custom; zeros there must not be turned into an unconditional “everything unlimited” promise.

## Customer-facing feature matrix

| Area | Supported marketing claim | Source / qualification |
| --- | --- | --- |
| Campaigns / broadcasts | Create one-to-many marketing campaigns, design content, target an audience, test, send now or schedule. | Dashboard `apps/web/app/(app)/campaigns/create/create-form.tsx`, editor `apps/web/app/(app)/campaigns/[id]/editor/editor-client.tsx`; API `apps/api-v2-go/internal/app/router.go:278` exposes `/v1/broadcasts` draft/update/send/cancel/stats. Hosted sends consume the same allowance; no separate unlimited campaign allowance. |
| Campaign targeting | Target tags and campaign engagement, including opened/clicked inclusion or exclusion. | `apps/web/app/(app)/campaigns/create/create-form.tsx:158`, `:498`; `apps/web/services/campaign-send-planner.ts`; `apps/web/app/actions.ts:140`. |
| Subject-line tests | A/B subject testing with a winner stage. | `apps/web/app/(app)/campaigns/create/create-form.tsx:286`; runtime `apps/api-v2-go/internal/dispatcher/abtest.go`. Do not describe every campaign field as automatically optimized. |
| Reusable email design | Visual editing of responsive templates, reusable structured rows/columns/blocks, HTML output, template publication/version handling. | `apps/web/app/(app)/templates/editor.tsx`, `apps/web/components/email-editor/template-document.ts`; template API routes in `apps/api-v2-go/internal/app/router.go:352`. Template counts are plan limited. |
| Transactional API | Send application email through one API; single, batch and bulk endpoints; scheduling, cancellation, template/variable rendering, idempotent requests. | `apps/docs/content/docs/quickstart.mdx`; `apps/api-v2-go/internal/app/router.go:95–133`; current contract `apps/web/openapi/openapi.yaml:469–611`. Verified sending domain required. `202 Accepted` confirms acceptance/queueing, not delivery. |
| SMTP | Send application/WordPress email over authenticated TLS SMTP. | `apps/docs/content/docs/guides/smtp.mdx`; SMTP hostname `smtp.sendmailos.com`, STARTTLS port2525 or implicit TLS2465; dashboard `apps/web/app/(app)/api-keys/smtp/smtp-setup.tsx`. It is outbound submission, not a mailbox. Outgoing SMTP attachments are currently rejected; use API/campaign attachment support where appropriate. |
| Visual workflows | Automate journeys from subscriber, tag, date, schedule, webhook, pixel, audience, bounce/complaint triggers. Branch on conditions, wait, send email, update tags/profiles, call HTTP endpoints, split paths. | UI `apps/web/components/workflows/sidebar.tsx:75–138`; validation `apps/web/lib/workflow-contract.ts`; actual Go runtime `apps/api-v2-go/internal/workflow/types.go`, `executor.go`, `spawner.go`, `date_trigger.go`. Execution and step limits apply; production workflow loops are not supported. |
| Audience / subscribers | Import CSV contacts, manage tags and profiles, search/filter, unsubscribe, build targeted audiences. | `apps/web/app/actions.ts:56`, `:157`, `:213`, `:248`, `:291`; `apps/web/app/(app)/subscribers/page.tsx`; API subscribers/audiences/topics routes in `apps/api-v2-go/internal/app/router.go`. Imports validate and deduplicate; consent and active-subscriber limits still apply. |
| Pixel / web behavior | Track page/product/cart/purchase activity, connect behavior to known subscribers, create segments and trigger automations. | `apps/web/app/(app)/pixel/pixel-view.tsx:481`; `apps/web/app/actions/pixels.ts`; actual ingestion/runtime `apps/api-v2-go/internal/pixeltrack/`; live/saved segments `apps/web/lib/live-segments.ts`, `apps/api-v2-go/internal/pixelsegments/`. Do not claim anonymous email-address discovery. |
| Consent-aware pixel | Explicit/auto-EU/off consent settings, optional analytics banner, consent-aware identity and configurable attribution. | `apps/web/app/(app)/pixel/pixel-view.tsx:45–47`, `:347–408`; `apps/web/lib/pixel-settings.ts`; pixel SDK/privacy tests. This is functionality, not a guarantee of GDPR/ePrivacy compliance. |
| Behavior segments | Saved/live behavior segments, tag matching subscribers and use those tags for campaigns/workflows. | `apps/web/app/actions/pixels.ts:482–633`; behavior UI `apps/web/app/(app)/pixel/segments/behavior-segments.tsx:183` explains identity is linked through a signed email click to an existing subscriber. Current saved-segment cap:20 per pixel. |
| Inbox / replies | Keep replies linked to sent emails, read conversation history, reply from the dashboard, mark read/closed, receive attachments. Capture future API/SMTP/campaign/workflow replies when enabled. | Actual dashboard `apps/web/app/(app)/inbox/page.tsx`, `inbox-client.tsx`; `apps/web/app/actions/conversations.ts`; docs `apps/docs/content/docs/guides/conversations.mdx`; API `apps/api-v2-go/internal/app/router.go:451`. Receiving infrastructure and verified reply domain must be configured. This is a reply inbox, not general IMAP/Gmail replacement, malware scanner, or full helpdesk. |
| Delivery visibility | View email status, delivery/open/click/bounce events, campaign reporting, and webhook deliveries. | `apps/web/services/campaign-report.ts`; `apps/web/app/(app)/logs/page.tsx`, `emails/page.tsx`; API message/events/analytics routes; `apps/docs/content/docs/guides/webhooks.mdx`. Avoid fabricated open rates, delivery percentages, uptime SLAs, or claims that opens equal a human reading. |
| Verified webhooks | Receive signed events; test and activate endpoints; retry failed deliveries; inspect/replay deliveries. | `apps/docs/content/docs/guides/webhooks.mdx`; actual API routes `apps/api-v2-go/internal/app/router.go:321`. Events include sent/delivered/opened/clicked/bounced/complained/suppressed/received. Webhook limits apply. |
| Domain setup | Verify sending domains and configure DKIM, custom MAIL FROM/SPF, tracking CNAME, and receiving subdomains. | `apps/web/app/(app)/domains/[id]/domain-details-client.tsx:172–220`, `domain-receiving.tsx`; quickstart docs. Authentication supports deliverability; it does not guarantee inbox placement. |
| Connected servers / BYOS | On eligible plans, connect a VPS agent and route sending through the customer's own server/IP. | `apps/web/app/(app)/servers/page.tsx`; `apps/web/app/actions/servers.ts`; SMTP guide explains server-only/hybrid routing and hosted-credit behavior. Starter+ only, infrastructure/provider restrictions apply. Do not reduce this to unconditional free unlimited sending. |
| Template MCP / assistants | Connect ChatGPT, Claude, or compatible MCP clients; create/update/render/publish responsive structured email templates that remain visually editable. | `apps/web/app/api/mcp/route.ts:104–132`, `:190–510`; `apps/docs/content/docs/guides/mcp-template-studio.mdx`. Streamable HTTP with OAuthPKCE, approved organization scopes, revocable under Connected Apps. Optional read tools also list subscribers/broadcasts and read email analytics when their additional scopes are granted (`:534–597`). Current MCP does not expose campaign sending, workflow mutation, or general whole-account management. |
| Organizations / team | Organization switching, owner/admin roles, team membership and scoped connected apps. | `apps/web/app/(app)/DashboardShell.tsx`; organization actions/UI; MCP guide approved-organization section. Member count is plan limited. Avoid promising legacy agency workspaces or white labeling. |

## Explicit exclusions for this redesign

- **No invented testimonials, customer logos, subscriber totals, percentage lifts, review ratings, delivery statistics, or SLA badges.** No evidence for these was collected.
- **Do not say all features are free or unlimited.** The Free allowance is meaningful but finite; servers are gated.
- **Do not advertise a launched native WordPress plugin yet.** `apps/web/app/(app)/connected-apps/page.tsx:4–6` explicitly hides the plugin card in production because it is not launched. Generic SMTP integration with WordPress is documented and can be described.
- **Do not market a general AI copywriting/AI-agent product.** Template MCP connects assistants users already choose. Old AI credits, ghost inboxes, and legacy workspaces are marked cut/irrelevant in `apps/web/services/subscription-service.ts:5–9`, `:43–51`.
- **Do not claim universal inbound-mail hosting.** Native receiving captures replies/conversations with configured MX infrastructure; existing business mailboxes keep their own MX.
- **Do not promise SMTP attachments or general backend execution from templates.** Follow the actual API/SMTP boundaries.
- The older `apps/web/migrations/025_subscription_plans.sql` and old blog marketing differ from current entitlements. Use the newer catalogue and automation migrations above.

For a static marketing launch, the Free plan figures are directly supported by checked-in configuration and the user's explicit offer. Paid-price cards should be reconciled with the current public catalogue before external publication, since this audit intentionally did not access live billing data.
