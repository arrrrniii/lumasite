import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { startServers } from '../src/server.mjs';

async function unusedPorts() {
  const listeners = await Promise.all([0, 1].map(() => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  })));
  const ports = listeners.map(server => server.address().port);
  await Promise.all(listeners.map(server => new Promise(resolve => server.close(resolve))));
  return ports;
}

test('blank-data first-run setup establishes a session and a configured, healthy instance', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'lumasite-setup-'));
  const [port, sitePort] = await unusedPorts();
  const previous = Object.fromEntries(['PORT', 'LUMASITE_SITE_PORT', 'LUMASITE_HOST'].map(key => [key, process.env[key]]));
  let servers;
  t.after(async () => {
    if (servers) await servers.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  process.env.PORT = String(port);
  process.env.LUMASITE_SITE_PORT = String(sitePort);
  process.env.LUMASITE_HOST = '127.0.0.1';
  try { servers = await startServers({ dataDir }); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  const admin = `http://127.0.0.1:${port}`;
  const site = `http://127.0.0.1:${sitePort}`;
  const before = await (await fetch(`${admin}/api/setup`)).json();
  assert.equal(before.configured, false);
  assert.equal(before.port, port);
  assert.equal(before.sitePort, sitePort);
  assert.equal((await fetch(`${admin}/api/projects`)).status, 401);

  const setup = await fetch(`${admin}/api/setup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'Initial-Setup-Password-123!' }),
  });
  assert.equal(setup.status, 201);
  const body = await setup.json();
  assert.ok(body.instance.id);
  assert.match(body.adminToken, /^ls_admin_/);
  assert.equal(body.instance.passwordHash, undefined);
  const setCookie = setup.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/i);
  const cookie = setCookie.split(';')[0];
  const session = await fetch(`${admin}/api/session`, { headers: { Cookie: cookie } });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).authenticated, true);
  assert.equal((await (await fetch(`${admin}/api/setup`)).json()).configured, true);
  for (const origin of [admin, site]) {
    const health = await (await fetch(`${origin}/health`)).json();
    assert.equal(health.instanceId, body.instance.id);
    assert.equal(health.pid, process.pid);
    assert.equal(health.port, port);
    assert.equal(health.sitePort, sitePort);
  }
  assert.equal((await fetch(`${admin}/ready`)).status, 200);
  const secondSetup = await fetch(`${admin}/api/setup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'Different-Password-456!' }),
  });
  assert.equal(secondSetup.status, 409);
});
