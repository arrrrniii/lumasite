// Optional Docker integration: real Traefik + disposable LumaSite, no live data or public ports.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import https from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import { openStore } from '../src/store.mjs';
import { initializeInstance, createProject, publishPage } from '../src/service.mjs';
import { startServers } from '../src/server.mjs';
import { generateProxyConfig } from '../src/proxy.mjs';
import { detectServer } from '../src/server-detection.mjs';

const exec = promisify(execFile);
const run = args => exec('docker', args, { timeout: 120000, maxBuffer: 1024 * 1024 });
const temporary = await mkdtemp(path.join(os.tmpdir(), 'lumasite-traefik-'));
const image = process.env.LUMASITE_TEST_TRAEFIK_IMAGE || 'traefik:v3';
let servers, container;
async function freePort() {
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '0.0.0.0', resolve));
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve)); return port;
}
function request(port, hostname, pathname, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    // Only this isolated test uses Traefik's self-signed default certificate.
    const req = https.request({ host: '127.0.0.1', port, servername: hostname, path: pathname, rejectUnauthorized: false, method, headers: { Host: hostname, ...headers }, timeout: 4000 }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Proxy request timed out'))); req.end(body);
  });
}
try {
  const port = await freePort(); let sitePort = await freePort(); while (sitePort === port) sitePort = await freePort();
  const store = await openStore(path.join(temporary, 'data'));
  const credentials = await initializeInstance(store, { host: '0.0.0.0', port, sitePort, publicUrl: 'https://studio.example.test', sitePublicUrl: 'https://preview.example.test' });
  const project = await createProject(store, { name: 'Proxy test', domain: 'example.test' });
  await publishPage(store, project.project.id, store.read().pages[0].id);
  servers = await startServers({ store, dataDir: store.dataDir });
  const config = path.join(temporary, 'dynamic.yml');
  await writeFile(config, generateProxyConfig({ format: 'traefik', adminDomain: 'studio.example.test', domain: 'example.test', siteDomain: 'preview.example.test', port, sitePort, upstreamHost: 'host.docker.internal' }));
  const result = await run(['run', '--detach', '--name', `lumasite-traefik-test-${path.basename(temporary)}`, '--publish', '127.0.0.1::8443', ...(process.platform === 'linux' ? ['--add-host', 'host.docker.internal:host-gateway'] : []), '--mount', `type=bind,source=${config},target=/etc/lumasite/dynamic.yml,readonly`, image, '--entrypoints.websecure.address=:8443', '--providers.file.filename=/etc/lumasite/dynamic.yml', '--log.level=ERROR']);
  container = result.stdout.trim();
  const mapped = Number((await run(['port', container, '8443/tcp'])).stdout.trim().split(':').at(-1));
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await request(mapped, 'studio.example.test', '/admin')).status === 200) { ready = true; break; } } catch {}
    await delay(250);
  }
  assert.equal(ready, true, 'Traefik reaches the native Studio through the configured Docker backend');
  assert.equal((await request(mapped, 'example.test', '/')).status, 200, 'Host header selects production website');
  assert.equal((await request(mapped, 'preview.example.test', '/sites/proxy-test/')).status, 200);
  assert.equal((await request(mapped, 'example.test', '/api/projects')).status, 404, 'Public router cannot access admin API');
  assert.equal((await request(mapped, 'studio.example.test', '/api/projects')).status, 401);
  assert.equal((await request(mapped, 'studio.example.test', '/api/projects', { headers: { Authorization: `Bearer ${credentials.adminToken}` } })).status, 200);
  assert.match((await request(mapped, 'example.test', '/sitemap.xml')).text, /https:\/\/example\.test\//);
  const mcp = await request(mapped, 'studio.example.test', `/mcp/${project.project.id}`, { method: 'POST', headers: { Authorization: `Bearer ${project.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'traefik-test', version: '1.0.0' } } }) });
  assert.equal(mcp.status, 200);
  const report = await detectServer();
  assert.ok(report.proxies.find(proxy => proxy.id === 'traefik')?.containers.some(item => item.name.endsWith(path.basename(temporary)) && item.networkMode !== 'unknown'));
  console.log(JSON.stringify({ image, routing: 'passed', hostPreservation: 'passed', studio: 'passed', adminIsolation: 'passed', authenticatedApi: 'passed', mcp: 'passed', sitemap: 'passed', dockerDetection: 'passed', tls: 'test certificate only' }));
} finally {
  if (container) await run(['rm', '--force', container]);
  if (servers) await servers.close();
  await rm(temporary, { recursive: true, force: true });
}
