import test from 'node:test';
import assert from 'node:assert/strict';
import { detectServer, formatDetection } from '../src/server-detection.mjs';
import { generateProxyConfig } from '../src/proxy.mjs';
import { parse } from 'yaml';

const success = stdout => ({ ok: true, stdout, stderr: '' });
async function scan({ binaries = [], processes = '', services = '', sockets = '', docker = [], networks = {}, platform = 'linux', open = [], unavailableSockets = false, unavailablePorts = false } = {}) {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, ...args]);
    if (binaries.includes(command)) return success('version');
    if (command === 'ps') return success(processes);
    if (command === 'systemctl') return success(services);
    if (command === 'ss' || command === 'lsof') return unavailableSockets ? { ok: false, reason: 'unavailable' } : success(sockets);
    if (command === 'docker' && args[0] === 'ps') return success(docker.map(row => row.map(value => JSON.stringify(value)).join('\t')).join('\n'));
    if (command === 'docker' && args[0] === 'inspect') return success(networks[args.at(-1)] || 'bridge');
    return { ok: false, reason: 'not-found', stdout: '' };
  };
  const report = await detectServer({ run, platform, probePort: async port => { if (unavailablePorts) throw new Error('permission'); return open.includes(port) ? 'open' : 'closed'; } });
  return { report, calls };
}

test('detection distinguishes installed Apache from running Apache and keeps service probes read-only', async () => {
  const { report, calls } = await scan({ binaries: ['apachectl'] });
  assert.equal(report.proxies[0].id, 'apache');
  assert.equal(report.proxies[0].installed, true);
  assert.equal(report.proxies[0].running, false);
  assert.equal(report.recommendation.proxy, 'apache');
  assert.match(report.recommendation.reason, /enable it separately/);
  assert.ok(calls.some(call => call[0] === 'apachectl'));
  assert.ok(calls.some(call => call.join(' ') === 'ps -A -o comm='));
  assert.equal(calls.some(call => call.some(arg => /^(sudo|restart|stop|start|reload|env|exec)$/.test(arg))), false);
});

test('running public Apache takes precedence over an idle Caddy installation', async () => {
  const { report } = await scan({ binaries: ['caddy'], services: 'apache2.service loaded active running Apache', sockets: 'LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("apache2",pid=10,fd=4))' });
  assert.equal(report.recommendation.proxy, 'apache');
  assert.deepEqual(report.ports[0].proxies, ['apache']);
  assert.deepEqual(report.proxies.find(proxy => proxy.id === 'apache').publicPorts, [80]);
});

test('macOS lsof inventory detects Caddy bound on a non-loopback interface', async () => {
  const { report } = await scan({ platform: 'darwin', sockets: 'p123\nccaddy\nn192.0.2.3:443\n' });
  assert.equal(report.checks.sockets, 'lsof');
  assert.equal(report.recommendation.proxy, 'caddy');
  assert.equal(report.ports[1].state, 'open');
});

test('multiple public proxies and unidentified listeners require an explicit choice', async () => {
  const mixed = await scan({ sockets: 'LISTEN 0 511 *:80 *:* users:(("apache2",pid=10,fd=4))\nLISTEN 0 511 *:443 *:* users:(("traefik",pid=11,fd=4))' });
  assert.equal(mixed.report.recommendation.requiresChoice, true);
  const unknown = await scan({ processes: '/usr/bin/caddy\n', open: [80], unavailableSockets: true });
  assert.equal(unknown.report.recommendation.requiresChoice, true, 'Running elsewhere is not proof that Caddy owns an unidentified listener');
  const partlyUnknown = await scan({ sockets: 'LISTEN 0 511 *:80 *:* users:(("caddy",pid=10,fd=4))\nLISTEN 0 511 192.0.2.1:443 *:* users:(("node",pid=11,fd=4))' });
  assert.equal(partlyUnknown.report.recommendation.requiresChoice, true);
});

test('missing tools are not fatal, while incomplete TCP probes never imply free ports', async () => {
  const free = await scan({ unavailableSockets: true });
  assert.equal(free.report.recommendation.proxy, 'caddy');
  assert.match(formatDetection(free.report), /Unavailable probes: sockets/);
  const incomplete = await scan({ unavailablePorts: true, unavailableSockets: true });
  assert.equal(incomplete.report.recommendation.requiresChoice, true);
  const thrown = await detectServer({ run: async () => { throw new Error('permissions'); }, probePort: async () => 'unknown' });
  assert.equal(thrown.recommendation.requiresChoice, true);
});

test('existing Nginx is reported for manual routing instead of suggesting a competing proxy', async () => {
  const { report } = await scan({ processes: '/usr/sbin/nginx', sockets: 'LISTEN 0 511 *:443 *:* users:(("nginx",pid=9,fd=4))' });
  assert.equal(report.recommendation.proxy, 'none');
  assert.match(report.recommendation.reason, /Nginx/);
});

test('Docker detection maps published ports, inspects only network mode, and flags name-only matches', async () => {
  const { report, calls } = await scan({ sockets: 'LISTEN 0 511 *:443 *:* users:(("docker-proxy",pid=9,fd=4))', docker: [['edge', 'traefik:v3', '0.0.0.0:80->80/tcp, [::]:443->443/tcp']], networks: { edge: 'proxy-network' } });
  assert.equal(report.recommendation.proxy, 'traefik');
  assert.equal(report.proxies[0].containers[0].networkMode, 'proxy-network');
  assert.deepEqual(report.proxies[0].publicPorts, [80, 443]);
  assert.ok(calls.some(call => call.join(' ') === 'docker inspect --format {{.HostConfig.NetworkMode}} edge'));
  const weak = await scan({ binaries: ['traefik'], docker: [['old-traefik-1', 'custom/edge:latest', '']] });
  assert.equal(weak.report.proxies[0].uncertain, true, 'An installed binary does not prove the custom container is Traefik');
  assert.equal(weak.report.recommendation.requiresChoice, true);
  for (const docker of [ [['traefik-custom', 'custom/image', ''], ['edge', 'traefik:v3', '']], [['edge', 'traefik:v3', ''], ['traefik-custom', 'custom/image', '']] ]) {
    assert.equal((await scan({ docker })).report.proxies[0].uncertain, false, 'Confidence must not depend on container completion order');
  }
});

test('container network inspection is bounded and terminal control codes are stripped', async () => {
  const { report, calls } = await scan({ docker: Array.from({ length: 18 }, (_, index) => [`edge-${index}`, 'traefik:v3', '']), networks: { 'edge-0': '\u001b\nbridge' } });
  assert.equal(calls.filter(call => call[0] === 'docker' && call[1] === 'inspect').length, 12);
  assert.equal(report.proxies[0].containers.length, 18);
  assert.equal(JSON.stringify(report).includes('\\u001b'), false);
  assert.match(formatDetection(report), /containerNetworks/);
});

test('Traefik YAML routes website and preview separately from Studio and preserves Host', () => {
  const base = { format: 'traefik', adminDomain: 'studio.example.com', domain: 'example.com', siteDomain: 'preview.example.com', port: 4310, sitePort: 4311 };
  const config = parse(generateProxyConfig({ ...base, traefikEntryPoint: 'https', traefikCertResolver: 'letsencrypt', upstreamHost: 'host.docker.internal' }));
  const [admin, site] = Object.values(config.http.routers);
  assert.equal(admin.rule, 'Host(`studio.example.com`)');
  assert.equal(site.rule, 'Host(`example.com`) || Host(`preview.example.com`)');
  assert.deepEqual(admin.entryPoints, ['https']); assert.deepEqual(admin.tls, { certResolver: 'letsencrypt' });
  const services = Object.values(config.http.services);
  assert.equal(services[0].loadBalancer.servers[0].url, 'http://host.docker.internal:4310');
  assert.equal(services[1].loadBalancer.servers[0].url, 'http://host.docker.internal:4311');
  assert.equal(services[1].loadBalancer.passHostHeader, true);
  const existingTls = parse(generateProxyConfig(base));
  assert.deepEqual(Object.values(existingTls.http.routers)[0].tls, {});
  assert.notEqual(Object.keys(existingTls.http.routers)[0], Object.keys(parse(generateProxyConfig({ ...base, domain: 'second.example.com' })).http.routers)[0], 'Multiple instances get distinct router names');
  assert.match(generateProxyConfig({ ...base, upstreamHost: '::1' }), /http:\/\/\[::1\]:4310/);
  for (const patch of [{ upstreamHost: 'http://host:8080' }, { upstreamHost: 'host\nrule: evil' }, { traefikEntryPoint: 'https\nrule: evil' }, { traefikCertResolver: 'name`)' }, { adminDomain: 'example.com' }]) assert.throws(() => generateProxyConfig({ ...base, ...patch }));
});
