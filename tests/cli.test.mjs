import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { generateProxyConfig } from '../src/proxy.mjs';

const exec = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/lumasite.mjs', import.meta.url));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function fixture(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumasite-cli-'));
  const command = async (...args) => {
    try {
      const result = await exec(process.execPath, [bin, ...args, '--data-dir', dataDir, '--json'], { timeout: 25000, maxBuffer: 2 * 1024 * 1024 });
      return { ...result, code: 0, data: JSON.parse(result.stdout) };
    } catch (error) { return { ...error, code: error.code, data: error.stdout ? JSON.parse(error.stdout) : null }; }
  };
  t.after(async () => { await command('stop'); await fs.rm(dataDir, { recursive: true, force: true }); });
  const port = await freePort();
  let sitePort = await freePort();
  while (sitePort === port) sitePort = await freePort();
  const initialized = await command('init', '--name', 'CLI Test', '--domain', 'cli-test.example', '--port', String(port), '--site-port', String(sitePort));
  assert.equal(initialized.code, 0, initialized.stderr);
  return { dataDir, command, port, sitePort, initialized: initialized.data };
}

test('CLI manages a real instance, exposes project URLs, and backs up its data', { timeout: 65000 }, async t => {
  const { command, dataDir, port, sitePort, initialized } = await fixture(t);
  t.after(async () => { await command('stop'); });
  assert.equal(initialized.projects[0].name, 'CLI Test');
  assert.match(initialized.projects[0].mcp, /\/mcp\//);
  assert.ok(initialized.password);
  assert.equal((await fs.stat(path.join(dataDir, 'credentials.json'))).mode & 0o077, 0);

  const started = await command('start');
  assert.equal(started.code, 0, started.stderr);
  assert.equal(started.data.port, port);
  assert.equal(started.data.sitePort, sitePort);
  assert.equal(started.data.healthy, true);
  assert.equal(started.data.managed, true);
  const firstPid = started.data.pid;
  const repeated = await command('start');
  assert.equal(repeated.data.pid, firstPid);
  assert.equal(repeated.data.alreadyRunning, true);
  assert.equal((await command('health')).code, 0);
  assert.equal((await command('doctor')).code, 0);

  const second = await command('project', 'create', '--name', 'Live second project', '--domain', 'second.example');
  assert.equal(second.code, 0, second.stderr);
  const projects = await command('project', 'list');
  assert.equal(projects.data.projects.length, 2);
  const credentials = await command('credentials');
  assert.ok(credentials.data.adminToken);
  const response = await fetch(`http://127.0.0.1:${port}/api/projects`, { headers: { Authorization: `Bearer ${credentials.data.adminToken}` } });
  assert.equal((await response.json()).projects.length, 2, 'CLI changes must be visible immediately to the live server');

  const snapshot = path.join(path.dirname(dataDir), `${path.basename(dataDir)}-backup`);
  t.after(() => fs.rm(snapshot, { recursive: true, force: true }));
  const saved = await command('backup', '--output', snapshot);
  assert.equal(saved.code, 0, saved.stderr);
  assert.equal((JSON.parse(await fs.readFile(path.join(snapshot, 'state.json'), 'utf8'))).projects.length, 2);
  await assert.rejects(fs.access(path.join(snapshot, 'run.json')));
  assert.equal((await fs.stat(snapshot)).mode & 0o077, 0);

  const proxy = await command('proxy', '--format', 'caddy', '--admin-domain', 'studio.example.com', '--domain', 'www.example.com');
  assert.equal(proxy.code, 0, proxy.stderr);
  assert.match(proxy.data.config, new RegExp(`127\\.0\\.0\\.1:${sitePort}`));

  const restarted = await command('restart');
  assert.equal(restarted.code, 0, restarted.stderr);
  assert.notEqual(restarted.data.pid, firstPid);
  assert.equal(restarted.data.healthy, true);
  const logs = await command('logs', '--lines', '20');
  assert.equal(logs.code, 0, logs.stderr);
  assert.ok(logs.data.lines.length > 0);
  const stopped = await command('stop');
  assert.equal(stopped.code, 0, stopped.stderr);
  assert.equal(stopped.data.status, 'stopped');
  assert.equal((await command('stop')).data.alreadyStopped, true);
  assert.equal((await command('status')).code, 1);
  assert.equal((await command('health')).code, 1);
});

test('stop refuses an unrelated living PID and start refuses an occupied listener', { timeout: 30000 }, async t => {
  const { dataDir, command, initialized, port } = await fixture(t);
  await fs.writeFile(path.join(dataDir, 'run.json'), JSON.stringify({ pid: process.pid, instanceId: 'wrong-instance' }));
  const stopped = await command('stop');
  assert.equal(stopped.code, 1);
  assert.match(stopped.stderr, /Cannot verify.*No signal sent/);
  process.kill(process.pid, 0);
  await fs.rm(path.join(dataDir, 'run.json'));
  const other = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ status: 'ok', instanceId: 'other', pid: process.pid })); });
  await new Promise(resolve => other.listen(port, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => other.close(resolve)));
  const started = await command('start');
  assert.equal(started.code, 1);
  assert.match(started.stderr, /another service/);
  assert.equal(initialized.port, port);
});

test('logs --follow emits newly appended lines and exits on SIGTERM', { timeout: 15000 }, async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumasite-follow-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const child = spawn(process.execPath, [bin, 'logs', '--follow', '--data-dir', dataDir], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGTERM'));
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No live log received: ${output}`)), 8000);
    child.once('error', reject);
    child.stdout.on('data', async bytes => {
      output += bytes.toString();
      if (output.includes('No logs yet') && !output.includes('test-follow-line')) {
        await new Promise(done => setTimeout(done, 100));
        await fs.appendFile(path.join(dataDir, 'logs/server.log'), 'test-follow-line\n');
      }
      if (output.includes('test-follow-line')) { clearTimeout(timer); resolve(); }
    });
  });
  child.kill('SIGTERM');
  const code = await new Promise(resolve => child.once('exit', resolve));
  assert.equal(code, 0);
});

test('proxy generation isolates admin origin and rejects configuration injection', () => {
  const apache = generateProxyConfig({ adminDomain: 'studio.example.com', domain: 'example.com', port: 4310, sitePort: 4311 });
  assert.match(apache, /ServerName studio\.example\.com/);
  assert.match(apache, /127\.0\.0\.1:4311/);
  assert.throws(() => generateProxyConfig({ adminDomain: 'example.com', domain: 'example.com', port: 4310, sitePort: 4311 }), /different hostnames/);
  assert.throws(() => generateProxyConfig({ adminDomain: 'studio.example.com', domain: 'example.com\nInclude evil', port: 4310, sitePort: 4311 }), /hostname/);
});
