import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import path from 'node:path';

const execute = promisify(execFile);
const definitions = [
  { id: 'apache', label: 'Apache', binaries: ['apache2', 'httpd', 'apachectl', 'apache2ctl'], args: ['-v'], services: ['apache2', 'httpd'] },
  { id: 'caddy', label: 'Caddy', binaries: ['caddy'], args: ['version'], services: ['caddy'] },
  { id: 'traefik', label: 'Traefik', binaries: ['traefik'], args: ['version'], services: ['traefik'] },
  { id: 'nginx', label: 'Nginx', binaries: ['nginx'], args: ['-v'], services: ['nginx'] },
];
const clean = value => String(value || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, 180);
const identity = value => {
  const name = path.posix.basename(String(value || '').replaceAll('\\', '/')).replace(/\.exe$/i, '').toLowerCase();
  if (['apache2', 'httpd', 'apachectl', 'apache2ctl'].includes(name)) return 'apache';
  return ['caddy', 'traefik', 'nginx'].includes(name) ? name : null;
};

async function runReadOnly(command, args) {
  try {
    const result = await execute(command, args, { timeout: 1800, maxBuffer: 256 * 1024, windowsHide: true, encoding: 'utf8' });
    return { ok: true, stdout: result.stdout || '', stderr: result.stderr || '' };
  } catch (error) {
    return { ok: false, stdout: error.stdout || '', stderr: '', reason: error.code === 'ENOENT' ? 'not-found' : error.killed ? 'timeout' : 'unavailable' };
  }
}

async function tcpState(port) {
  const states = await Promise.all(['127.0.0.1', '::1'].map(host => new Promise(resolve => {
    const socket = net.connect({ host, port });
    let done = false;
    const finish = state => { if (done) return; done = true; socket.destroy(); resolve(state); };
    socket.setTimeout(350, () => finish('unknown'));
    socket.once('connect', () => finish('open'));
    socket.once('error', error => finish(['ECONNREFUSED', 'EAFNOSUPPORT', 'ENETUNREACH', 'EADDRNOTAVAIL'].includes(error.code) ? 'closed' : 'unknown'));
  })));
  return states.includes('open') ? 'open' : states.every(state => state === 'closed') ? 'closed' : 'unknown';
}

function socketOwners(output, format) {
  const listeners = [];
  if (format === 'ss') {
    for (const line of output.split('\n')) {
      const address = line.trim().split(/\s+/)[3] || '';
      const port = Number(address.match(/:(80|443)$/)?.[1]);
      if (!port) continue;
      const names = [...line.matchAll(/"([^"]+)",pid=\d+/g)].map(match => clean(match[1]));
      listeners.push({ port, owners: names });
    }
  } else {
    let command = '';
    for (const line of output.split('\n')) {
      if (line.startsWith('p')) command = '';
      if (line.startsWith('c')) command = clean(line.slice(1));
      if (line.startsWith('n')) {
        const port = Number(line.match(/:(80|443)$/)?.[1]);
        if (port) listeners.push({ port, owners: command ? [command] : [] });
      }
    }
  }
  return listeners;
}

function containerProxy(image, name) {
  const base = String(image).toLowerCase().split('/').at(-1)?.split(/[:@]/)[0];
  if (base === 'httpd' || base === 'apache2') return { id: 'apache', confidence: 'image' };
  if (['caddy', 'traefik', 'nginx'].includes(base)) return { id: base, confidence: 'image' };
  // A custom image name is a weaker signal and is never selected automatically.
  const match = String(name).toLowerCase().match(/(?:^|[-_.])(apache2?|httpd|caddy|traefik|nginx)(?:$|[-_.\d])/);
  if (!match) return null;
  return { id: ['apache', 'apache2', 'httpd'].includes(match[1]) ? 'apache' : match[1], confidence: 'name' };
}

export function recommendProxy(report) {
  const occupied = report.ports.some(port => port.state === 'open');
  const unresolved = report.ports.some(port => port.state === 'open' && (!port.proxies.length || port.owners.some(owner => !identity(owner) && !(port.proxies.length && ['docker-proxy', 'docker'].includes(owner)))));
  if (unresolved) return { proxy: null, requiresChoice: true, reason: 'A listener on port 80 or 443 could not be assigned to a supported proxy reliably. Choose a proxy explicitly or choose none for manual configuration.' };
  const publicOwners = report.proxies.filter(proxy => proxy.publicPorts.length && !proxy.uncertain);
  const active = report.proxies.filter(proxy => proxy.running && !proxy.uncertain);
  const candidates = publicOwners.length ? publicOwners : active;
  if (candidates.length > 1) return { proxy: null, requiresChoice: true, reason: 'Multiple running web proxies were found. Select the one that should serve these domains.' };
  if (candidates.length === 1) {
    const proxy = candidates[0];
    if (proxy.id === 'nginx') return { proxy: 'none', requiresChoice: false, reason: 'Nginx is already running. Keep it and configure its routes manually; no Nginx template is generated.' };
    return { proxy: proxy.id, requiresChoice: false, reason: `${proxy.label} ${proxy.publicPorts.length ? 'appears on ports ' + proxy.publicPorts.join(', ') : 'is running'}. Reuse that proxy.` };
  }
  if (occupied || report.proxies.some(proxy => proxy.running && proxy.uncertain)) return { proxy: null, requiresChoice: true, reason: 'An existing listener or possible proxy could not be identified reliably. Choose a proxy explicitly or choose none for manual configuration.' };
  if (report.ports.some(port => port.state === 'unknown')) return { proxy: null, requiresChoice: true, reason: 'Public listener checks are incomplete. Choose the server configuration explicitly.' };
  const installed = report.proxies.filter(proxy => proxy.installed && proxy.id !== 'nginx');
  if (installed.length > 1) return { proxy: null, requiresChoice: true, reason: 'Several proxies are installed but none is confirmed running. Choose which configuration to generate.' };
  if (installed.length === 1) return { proxy: installed[0].id, requiresChoice: false, reason: `${installed[0].label} is installed but not confirmed running. Its configuration can be prepared; enable it separately.` };
  return { proxy: 'caddy', requiresChoice: false, reason: 'No active proxy was found. Caddy is the suggested new setup; it must be installed and enabled separately.' };
}

/** Bounded, read-only local probes. No sudo, config files, environment inspection, or service mutations. */
export async function detectServer({ run = runReadOnly, probePort = tcpState, platform = process.platform } = {}) {
  const proxies = definitions.map(({ id, label }) => ({ id, label, installed: false, running: false, uncertain: false, binaries: [], services: [], processes: [], containers: [], publicPorts: [] }));
  const byId = Object.fromEntries(proxies.map(proxy => [proxy.id, proxy]));
  const checks = {};
  const safeRun = async (command, args) => { try { return await run(command, args); } catch { return { ok: false, stdout: '', reason: 'unavailable' }; } };
  const portStates = Promise.all([80, 443].map(async port => {
    let state = 'unknown'; try { state = await probePort(port); } catch { /* An incomplete probe is not evidence of a free port. */ }
    return { port, state: ['open', 'closed'].includes(state) ? state : 'unknown', owners: [], proxies: [] };
  }));
  await Promise.all(definitions.map(async definition => {
    for (const binary of definition.binaries) {
      const result = await safeRun(binary, definition.args);
      if (result.ok) { byId[definition.id].installed = true; byId[definition.id].binaries.push(binary); break; }
    }
  }));
  const [ps, systemd, sockets, docker] = await Promise.all([
    safeRun('ps', ['-A', '-o', 'comm=']),
    platform === 'linux' ? safeRun('systemctl', ['list-units', '--type=service', '--state=running', '--no-legend', '--no-pager']) : Promise.resolve({ ok: false, reason: 'not-applicable' }),
    platform === 'linux' ? safeRun('ss', ['-H', '-ltnp']) : Promise.resolve({ ok: false, reason: 'not-applicable' }),
    safeRun('docker', ['ps', '--format', '{{json .Names}}\t{{json .Image}}\t{{json .Ports}}']),
  ]);
  checks.processes = ps.ok ? 'checked' : ps.reason || 'unavailable';
  if (ps.ok) for (const line of ps.stdout.split('\n')) {
    const id = identity(line.trim());
    if (id) { byId[id].running = true; byId[id].processes.push(clean(line.trim())); }
  }
  checks.services = systemd.ok ? 'checked' : systemd.reason || 'unavailable';
  if (systemd.ok) for (const line of systemd.stdout.split('\n')) {
    const service = line.trim().replace(/^[●*]\s*/, '').split(/\s+/)[0]?.replace(/\.service$/, '');
    const definition = definitions.find(item => item.services.includes(service));
    if (definition) { byId[definition.id].running = true; byId[definition.id].services.push(service); }
  }
  let listeners = sockets.ok ? socketOwners(sockets.stdout, 'ss') : [];
  checks.sockets = sockets.ok ? 'ss' : 'unavailable';
  if (!sockets.ok) {
    const lsof = await safeRun('lsof', ['-nP', '-iTCP:80', '-iTCP:443', '-sTCP:LISTEN', '-Fpcn']);
    if (lsof.ok) { listeners = socketOwners(lsof.stdout, 'lsof'); checks.sockets = 'lsof'; }
  }
  const ports = await portStates;
  for (const listener of listeners) {
    const item = ports.find(item => item.port === listener.port); item.state = 'open';
    for (const owner of listener.owners) {
      if (!item.owners.includes(owner)) item.owners.push(owner);
      const id = identity(owner);
      if (id) { byId[id].running = true; if (!item.proxies.includes(id)) item.proxies.push(id); }
    }
  }
  checks.docker = docker.ok ? 'checked' : docker.reason || 'unavailable';
  if (docker.ok) {
    const containers = docker.stdout.split('\n').slice(0, 200).flatMap(line => {
      try {
        const [name, image, exposed] = line.split('\t').map(value => JSON.parse(value));
        if (![name, image, exposed].every(value => typeof value === 'string')) return [];
        const match = containerProxy(image, name);
        return match ? [{ ...match, name: clean(name), image: clean(image), ports: clean(exposed) }] : [];
      } catch { return []; }
    });
    if (containers.length > 12) checks.containerNetworks = 'limited to 12 containers';
    await Promise.all(containers.map(async (container, index) => {
      // Docker's name grammar prevents command-option injection; inspect only network mode.
      const validName = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(container.name);
      const network = validName && index < 12 ? await safeRun('docker', ['inspect', '--format', '{{.HostConfig.NetworkMode}}', container.name]) : { ok: false };
      const info = { name: container.name, image: container.image, ports: container.ports, networkMode: network.ok ? clean(network.stdout) : 'unknown', confidence: container.confidence };
      const proxy = byId[container.id]; proxy.running = true; proxy.containers.push(info);
      for (const match of container.ports.matchAll(/:(80|443)->\d+\/tcp/g)) {
        const item = ports.find(port => port.port === Number(match[1])); item.state = 'open';
        if (container.confidence === 'image' && !item.proxies.includes(proxy.id)) item.proxies.push(proxy.id);
      }
    }));
  }
  for (const proxy of proxies) {
    proxy.publicPorts = ports.filter(port => port.proxies.includes(proxy.id)).map(port => port.port);
    proxy.processes = [...new Set(proxy.processes)].slice(0, 12);
    proxy.uncertain = proxy.running && !proxy.processes.length && !proxy.services.length && !proxy.publicPorts.length && !proxy.containers.some(container => container.confidence === 'image');
  }
  const report = { platform, proxies: proxies.filter(proxy => proxy.installed || proxy.running), ports, checks };
  report.recommendation = recommendProxy(report);
  return report;
}

export function formatDetection(report) {
  const lines = ['Server detection (read-only)'];
  if (!report.proxies.length) lines.push('  No supported proxy installation or process confirmed.');
  for (const proxy of report.proxies) {
    const detail = [proxy.running ? 'running' : 'installed; not confirmed running', proxy.publicPorts.length ? `ports ${proxy.publicPorts.join(', ')}` : '', proxy.containers.length ? `Docker: ${proxy.containers.map(container => `${container.name} (${container.networkMode})`).join(', ')}` : ''].filter(Boolean).join(' · ');
    lines.push(`  ${proxy.label}: ${detail}${proxy.uncertain ? ' (name-only match; verify)' : ''}`);
  }
  lines.push(`  Ports 80/443 (socket inventory + loopback probes): ${report.ports.map(port => `${port.port} ${port.state}${port.owners.length ? ` (${port.owners.join(', ')})` : ''}`).join('; ')}`);
  lines.push(`  ${report.recommendation.reason}`);
  const unavailable = Object.entries(report.checks).filter(([, value]) => !['checked', 'ss', 'lsof', 'not-applicable'].includes(value)).map(([name]) => name);
  if (unavailable.length) lines.push(`  Unavailable probes: ${unavailable.join(', ')}. Detection may be incomplete.`);
  return lines.join('\n');
}
