# Fit LumaSite to an existing server

In v0.6+, server-mode `create` and `setup` default to read-only proxy detection. The wizard shows what it found, suggests Apache, Caddy, or Traefik, and lets you override the choice. Local mode skips proxy detection.

Run detection separately, including before creating an instance:

```sh
lumasite detect
lumasite detect --json
```

In a generated v0.6+ project, use `npm run detect`. In a repository checkout, use `node bin/lumasite.mjs detect`. Detection returns a report even if some probes are unavailable; inspect `checks` and `recommendation.requiresChoice` in JSON. It does not require administrator credentials or initialize website data.

## What is checked

| Evidence | How it is used |
| --- | --- |
| Apache `apache2`/`httpd`/control binaries, Caddy, Traefik | Version probes establish installation, separately from running state |
| Process names and Linux systemd running units | Identify active proxies without reading process arguments |
| `ss` or `lsof` socket inventory | Attribute listeners on 80/443 when permissions allow |
| TCP connections to IPv4/IPv6 loopback | Supplement socket inventory; report open, closed, or unknown |
| Running Docker names, images, published ports | Recognize proxy containers and public port mappings |
| Docker network mode | Distinguish host networking from a container network |
| Nginx | Recommend manual routing (`none`); no Nginx template is generated |

Public-port ownership takes precedence over a proxy merely installed elsewhere. Multiple possible proxies or unidentified public listeners require a choice. A custom container name alone is a weak match. If no proxy is found, Caddy is suggested as a new setup; it is not installed or enabled automatically.

Probes use bounded timeouts and output. At most 200 Docker rows are examined and 12 matching container network modes inspected. No sudo, service lifecycle commands, Docker exec, environment/secret inspection, or existing configuration-file reads are used. Restricted socket permissions, remote proxies, custom images, rootless/other container engines, externally bound interfaces invisible to available probes, and nonstandard installations can limit detection. Review the report rather than treating it as proof of external connectivity.

## Wizard and automation

Illustrative report:

```text
Server detection (read-only)
  Apache: running · ports 80, 443
  Apache appears on ports 80, 443. Reuse that proxy.
Reverse proxy: apache/caddy/traefik/none [apache]:
```

Automatic server setup saves its report privately as `deployment/server-detection.json`, alongside proxy configuration and `NEXT-STEPS.txt`. Unattended ambiguous detection stops before initialization. An explicit `--proxy apache|caddy|traefik|none` bypasses detection for a known deployment; you then own the networking choice. `none` generates no proxy configuration.

The generator preserves the incoming Host header and separates Studio/API/MCP from public websites/media. It does not replace existing sites, bind ports 80/443, reload proxies, change DNS, issue certificates, or configure startup after reboot.

## Traefik on the host

Choose `traefik`, then enter the **existing** HTTPS entrypoint and optionally an existing certificate resolver. Example flags:

```sh
lumasite setup --yes --no-start --mode server \
  --name "My Website" --domain example.com \
  --data-dir /srv/my-website/data \
  --proxy traefik --traefik-entrypoint websecure \
  --traefik-cert-resolver letsencrypt
```

`websecure` and `letsencrypt` are example names, not newly provisioned settings. The generated `deployment/traefik-dynamic.yml` contains two TLS routers and two HTTP backend services: Studio → 4310, website/preview → 4311 (or your selected ports). Router/service names include a hostname-derived suffix to reduce collisions between installations.

Load the YAML through the existing Traefik file provider. For example, if that provider already watches `/etc/traefik/dynamic`, add the reviewed file there under a distinct name. If the file provider is not configured, add it through your existing static configuration workflow. Do not replace another provider's settings or an existing dynamic file blindly.

Leaving the resolver blank emits `tls: {}` using Traefik's existing certificate/default behavior; this does **not** promise a trusted certificate. Entrypoints, resolvers, ACME storage, and HTTP-to-HTTPS redirects are outside the generated dynamic file. See the official [file-provider reference](https://doc.traefik.io/traefik/reference/install-configuration/providers/others/file/) and [router reference](https://doc.traefik.io/traefik/reference/routing-configuration/http/routing/router/).

## Traefik, Caddy, or Apache inside Docker

Container loopback refers to that container. A bridged proxy cannot reach a native host process at `127.0.0.1:4310`.

When automatic detection finds this arrangement, the wizard requests a backend hostname/IP reachable from the proxy and explicit listener binding. For unattended auto detection, supply both `--proxy-host HOST` and `--host 0.0.0.0`. The exact HOST depends on the server's Docker networking. `host.docker.internal` works only when that name is actually configured; on Linux a host-gateway mapping may need to be configured in the proxy container first.

Restrict the backend ports to the proxy's network with the server's firewall/network configuration. Do not expose administrative backend ports broadly. Host-networked proxies can use the native loopback backend. If LumaSite itself runs in Docker, its bind, network, published ports, and proxy backend address must also be configured consistently.

## Existing installations

Detection is available without rerunning setup. Generate a fresh configuration for review:

```sh
lumasite proxy --format traefik --traefik-entrypoint websecure \
  --traefik-cert-resolver letsencrypt \
  --output ./lumasite-dynamic.yml --data-dir /srv/my-website/data
```

`--format auto` uses detection too; ambiguous results require an explicit format. For a container proxy use `--proxy-host HOST` after configuring a reachable LumaSite listener. The generator rejects a non-loopback backend for a loopback-only native instance. Output files are never overwritten.

Before production use, verify the actual domains, valid HTTPS, public pages/media, authenticated Studio/MCP, proxy logs, backend restrictions, and startup after reboot. Detection checks the machine where the CLI runs, not another server or its DNS.

## Verification from the source checkout

`npm test` covers installed/running distinctions, socket ownership, ambiguity, unavailable probes, Docker confidence/networking, bounded inspection, YAML parsing, setup refusal before initialization, private reports, CLI flags, and separate origins. `npm run test:package` installs the real distributable into temporary projects and checks the packaged detector.

With Docker available, `npm run test:traefik` starts a disposable real Traefik container and native LumaSite instance, then checks website/preview routing, Host preservation, Studio, authenticated API/MCP, public/admin isolation, sitemap, and container detection. It uses a temporary loopback-mapped proxy port and Traefik's test certificate; it removes its container and data afterward. Set `LUMASITE_TEST_TRAEFIK_IMAGE` to test a specific image tag or digest. This optional integration test may download the default `traefik:v3` image and does not test public DNS or trusted certificates.
