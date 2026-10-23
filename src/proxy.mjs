import net from 'node:net';
import { createHash } from 'node:crypto';

function hostname(value, label) {
  if (!value || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value)) {
    throw new Error(`${label} must be a hostname without a scheme, port, path, or wildcard.`);
  }
  return value.toLowerCase();
}

export function proxyHost(value = '127.0.0.1') {
  const host = String(value).replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return host;
  return hostname(host, 'Proxy backend host');
}

export function validateTraefikName(value, label) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value)) throw new Error(`${label} must use 1–64 letters, digits, dots, underscores or hyphens.`);
  return value;
}

export function generateProxyConfig({ format = 'apache', adminDomain, domain, siteDomain, port, sitePort, upstreamHost = '127.0.0.1', traefikEntryPoint = 'websecure', traefikCertResolver = '' }) {
  const admin = hostname(adminDomain, 'Admin domain');
  const site = hostname(domain, 'Website domain');
  const previews = siteDomain ? hostname(siteDomain, 'Preview domain') : null;
  if (admin === site || admin === previews) throw new Error('Admin and website must use different hostnames to isolate website scripts.');
  for (const p of [port, sitePort]) {
    if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error('Proxy ports must be valid TCP ports.');
  }
  const host = proxyHost(upstreamHost);
  const upstream = number => `http://${net.isIP(host) === 6 ? `[${host}]` : host}:${number}`;
  if (format === 'traefik') {
    validateTraefikName(traefikEntryPoint, 'Traefik entrypoint');
    if (traefikCertResolver) validateTraefikName(traefikCertResolver, 'Traefik certificate resolver');
    const prefix = `lumasite-${createHash('sha256').update(`${admin}|${site}`).digest('hex').slice(0, 12)}`;
    const tls = traefikCertResolver ? `\n        certResolver: ${JSON.stringify(traefikCertResolver)}` : ' {}';
    const rule = names => JSON.stringify(names.map(name => 'Host(`' + name + '`)').join(' || '));
    return `# Traefik dynamic configuration (file provider). Review before enabling.\n# The existing Traefik instance must define the ${traefikEntryPoint} entrypoint.\n# ${traefikCertResolver ? `Use the existing ${traefikCertResolver} certificate resolver.` : 'TLS uses existing certificates/defaults; choose a certificate resolver for ACME.'}\n# In Docker, backend URLs must be reachable from the proxy container.\nhttp:\n  routers:\n    ${prefix}-admin:\n      rule: ${rule([admin])}\n      entryPoints: [${JSON.stringify(traefikEntryPoint)}]\n      service: ${prefix}-admin\n      tls:${tls}\n    ${prefix}-site:\n      rule: ${rule([...new Set([site, previews].filter(Boolean))])}\n      entryPoints: [${JSON.stringify(traefikEntryPoint)}]\n      service: ${prefix}-site\n      tls:${tls}\n  services:\n    ${prefix}-admin:\n      loadBalancer:\n        passHostHeader: true\n        servers:\n          - url: ${JSON.stringify(upstream(port))}\n    ${prefix}-site:\n      loadBalancer:\n        passHostHeader: true\n        servers:\n          - url: ${JSON.stringify(upstream(sitePort))}\n`;
  }
  if (format === 'caddy') {
    return `# DNS for all hostnames must point to this server. Caddy manages HTTPS.\n${admin} {\n    reverse_proxy ${upstream(port).slice(7)}\n}\n\n${[site, previews].filter((v, i, a) => v && a.indexOf(v) === i).join(', ')} {\n    reverse_proxy ${upstream(sitePort).slice(7)}\n}\n`;
  }
  if (format !== 'apache') throw new Error('Proxy format must be apache, caddy or traefik.');
  return `# Enable Apache modules proxy, proxy_http, headers and ssl.\n# This is an HTTP starting configuration. Issue TLS certificates before production use.\n# Restrict backend listeners to the proxy; use loopback when both run on the host.\n<VirtualHost *:80>\n    ServerName ${admin}\n    ProxyPreserveHost On\n    ProxyPass / ${upstream(port)}/\n    ProxyPassReverse / ${upstream(port)}/\n    ProxyTimeout 300\n    Header always set X-Content-Type-Options nosniff\n</VirtualHost>\n\n<VirtualHost *:80>\n    ServerName ${site}\n${previews && previews !== site ? `    ServerAlias ${previews}\n` : ''}    ProxyPreserveHost On\n    ProxyPass / ${upstream(sitePort)}/\n    ProxyPassReverse / ${upstream(sitePort)}/\n    Header always set X-Content-Type-Options nosniff\n</VirtualHost>\n`;
}
