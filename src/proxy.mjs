function hostname(value, label) {
  if (!value || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value)) {
    throw new Error(`${label} must be a hostname without a scheme, port, path, or wildcard.`);
  }
  return value.toLowerCase();
}

export function generateProxyConfig({ format = 'apache', adminDomain, domain, siteDomain, port, sitePort }) {
  const admin = hostname(adminDomain, 'Admin domain');
  const site = hostname(domain, 'Website domain');
  const previews = siteDomain ? hostname(siteDomain, 'Preview domain') : null;
  if (admin === site || admin === previews) throw new Error('Admin and website must use different hostnames to isolate website scripts.');
  for (const p of [port, sitePort]) {
    if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error('Proxy ports must be valid TCP ports.');
  }
  if (format === 'caddy') {
    return `# DNS for all hostnames must point to this server. Caddy manages HTTPS.\n${admin} {\n    reverse_proxy 127.0.0.1:${port}\n}\n\n${[site, previews].filter((v, i, a) => v && a.indexOf(v) === i).join(', ')} {\n    reverse_proxy 127.0.0.1:${sitePort}\n}\n`;
  }
  if (format !== 'apache') throw new Error('Proxy format must be apache or caddy.');
  return `# Enable Apache modules proxy, proxy_http, headers and ssl.\n# This is an HTTP starting configuration. Issue TLS certificates before production use.\n# Keep both internal listeners bound to 127.0.0.1.\n<VirtualHost *:80>\n    ServerName ${admin}\n    ProxyPreserveHost On\n    ProxyPass / http://127.0.0.1:${port}/\n    ProxyPassReverse / http://127.0.0.1:${port}/\n    ProxyTimeout 300\n    Header always set X-Content-Type-Options nosniff\n</VirtualHost>\n\n<VirtualHost *:80>\n    ServerName ${site}\n${previews && previews !== site ? `    ServerAlias ${previews}\n` : ''}    ProxyPreserveHost On\n    ProxyPass / http://127.0.0.1:${sitePort}/\n    ProxyPassReverse / http://127.0.0.1:${sitePort}/\n    Header always set X-Content-Type-Options nosniff\n</VirtualHost>\n`;
}
