// Install the actual distributable into a disposable prefix, then run its CLI.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, createHash } from 'node:crypto';
const exec = promisify(execFile), source = fileURLToPath(new URL('..', import.meta.url));
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lumasite-package-'));
const prefix = path.join(directory, 'installed'), dataDir = path.join(directory, 'websites');
const app = path.join(directory, 'created website');
const bin = path.join(prefix, process.platform === 'win32' ? 'lumasite.cmd' : 'bin/lumasite');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (file, args, cwd = directory) => exec(file, args, { cwd, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
async function ports() {
  const servers = await Promise.all([0, 1].map(() => new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server));
  })));
  const values = servers.map(server => server.address().port);
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); return values;
}
try {
  const [archive] = JSON.parse((await run(npm, ['pack', '--json', '--pack-destination', directory], source)).stdout);
  const files = archive.files.map(file => file.path);
  for (const needed of ['bin/lumasite.mjs', 'bin/create-lumasite.mjs', 'src/create.mjs', 'src/setup.mjs', 'src/bootstrap.mjs', 'src/server.mjs', 'src/public-links.mjs', 'src/oauth.mjs', 'public/oauth.html', 'public/oauth.css', 'public/oauth.js', 'src/project-backups.mjs', 'src/project-lifecycle.mjs', 'src/server-detection.mjs', 'public/admin.html', 'public/fonts/dmsansvariable.woff2', 'public/fonts/soravariable.woff2', 'public/fonts/DMSans-OFL.txt', 'public/fonts/Sora-OFL.txt', 'vendor/lumafx/lumafx.global.js', 'vendor/lumafx/LICENSE']) assert.ok(files.includes(needed), `Missing package file: ${needed}`);
  assert.equal(files.some(file => /(^|\/)(?:\.lumasite|node_modules|marketing|test-results|\.env|credentials\.json|oauth\.json|state\.json)(?:\/|$)/.test(file) || /\.(zip|log|pem|key)$/.test(file)), false);
  await run(npm, ['install', '--global', '--prefix', prefix, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', path.join(directory, archive.filename)]);
  assert.match((await run(bin, ['--help'])).stdout, /Guided terminal installer/);
  assert.equal((await run(bin, ['--version'])).stdout.trim(), archive.version);
  const detected = JSON.parse((await run(bin, ['detect', '--json'])).stdout);
  assert.equal(detected.ports.length, 2); assert.equal(typeof detected.recommendation.requiresChoice, 'boolean');
  const [port, sitePort] = await ports();
  const setup = JSON.parse((await run(bin, ['setup', '--yes', '--name', 'Installed package', '--port', String(port), '--site-port', String(sitePort), '--data-dir', dataDir, '--json'])).stdout);
  assert.equal(setup.healthy, true); assert.equal(setup.managed, true);
  for (const route of ['/admin', '/admin-assets/admin.js', '/admin-assets/admin.css', '/admin-assets/fonts/dmsansvariable.woff2', '/admin-assets/fonts/soravariable.woff2', '/runtime/lumafx/lumafx.global.js', '/oauth/consent', '/admin-assets/oauth.js', '/admin-assets/oauth.css', '/.well-known/oauth-authorization-server']) assert.equal((await fetch(`http://127.0.0.1:${port}${route}`)).status, 200, route);
  const projectId = setup.projects[0].id;
  const metadata = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-protected-resource/mcp/${projectId}`);
  assert.equal(metadata.status, 200); assert.match((await metadata.json()).resource, new RegExp(`/mcp/${projectId}$`));
  const auth = { Authorization: `Bearer ${setup.projects[0].token}` };
  const credentials = JSON.parse(await fs.readFile(path.join(dataDir, 'credentials.json')));
  const headers = { Authorization: `Bearer ${credentials.adminToken}` };
  // Exercise OAuth through the installed package, including consent and a real
  // MCP request, so omitted server handlers/assets cannot hide behind source tests.
  const adminOrigin = `http://127.0.0.1:${port}`;
  const clientResponse = await fetch(`${adminOrigin}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Installed OAuth test', redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'], token_endpoint_auth_method: 'none' }) });
  assert.equal(clientResponse.status, 201); const oauthClient = await clientResponse.json();
  const verifier = randomBytes(32).toString('base64url');
  const authorization = new URL('authorize', setup.admin);
  const resourceMetadata = await (await fetch(`${adminOrigin}/.well-known/oauth-protected-resource/mcp/${projectId}`)).json();
  authorization.search = new URLSearchParams({ client_id: oauthClient.client_id, redirect_uri: oauthClient.redirect_uris[0], response_type: 'code', code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), resource: resourceMetadata.resource });
  const started = await fetch(authorization, { redirect: 'manual' }); assert.equal(started.status, 303);
  const requestId = new URL(started.headers.get('location'), authorization).searchParams.get('request');
  const consent = await (await fetch(`${adminOrigin}/api/oauth/requests/${requestId}`, { headers })).json();
  const approval = await fetch(`${adminOrigin}/api/oauth/requests/${requestId}/decision`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'allow', csrfToken: consent.csrfToken }) });
  assert.equal(approval.status, 200); const callback = new URL((await approval.json()).redirect);
  const tokenResponse = await fetch(`${adminOrigin}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: oauthClient.client_id, redirect_uri: oauthClient.redirect_uris[0], code: callback.searchParams.get('code'), code_verifier: verifier, resource: resourceMetadata.resource }) });
  assert.equal(tokenResponse.status, 200); const oauthTokens = await tokenResponse.json();
  const oauthMcp = await fetch(`${adminOrigin}/mcp/${projectId}`, { method: 'POST', headers: { Authorization: `Bearer ${oauthTokens.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'installed-oauth-test', version: '1' } } }) });
  assert.equal(oauthMcp.status, 200); await oauthMcp.body.cancel();
  const pageResponse = await fetch(`http://127.0.0.1:${port}/api/projects/${projectId}/pages`, { headers });
  assert.equal(pageResponse.status, 200); const page = (await pageResponse.json()).pages[0];
  const publish = await fetch(`http://127.0.0.1:${port}/api/projects/${projectId}/pages/${page.id}/publish`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(publish.status, 200, 'Installed Tailwind compiler can publish a page');
  assert.equal((await fetch(`http://127.0.0.1:${sitePort}/sites/installed-package/`)).status, 200);
  // An authenticated MCP initialize confirms runtime SDK files/dependencies were included.
  const mcp = await fetch(`http://127.0.0.1:${port}/mcp/${projectId}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'package-install-test', version: '1.0.0' } } }) });
  assert.equal(mcp.status, 200);
  await mcp.body.cancel();
  assert.equal(JSON.parse((await run(bin, ['health', '--data-dir', dataDir, '--json'])).stdout).status, 'healthy');
  const websiteZip = path.join(directory, 'website.zip');
  await run(bin, ['export', '--project', projectId, '--output', websiteZip, '--data-dir', dataDir, '--json']);
  const updated = JSON.parse((await run(bin, ['import', '--file', websiteZip, '--mode', 'update', '--project', projectId, '--confirm', 'installed-package', '--data-dir', dataDir, '--json'])).stdout);
  assert.equal(updated.status, 'updated'); assert.equal(updated.projects[0].id, projectId);
  const recovery = await fetch(`http://127.0.0.1:${port}${updated.backup.download}`, { headers });
  assert.equal(recovery.status, 200); assert.equal(Buffer.from(await recovery.arrayBuffer()).readUInt32LE(0), 0x04034b50);
  const removed = JSON.parse((await run(bin, ['project', 'delete', '--project', projectId, '--confirm', 'installed-package', '--data-dir', dataDir, '--json'])).stdout);
  assert.equal(removed.status, 'deleted'); assert.equal((await fetch(`http://127.0.0.1:${sitePort}/sites/installed-package/`)).status, 404);
  await run(bin, ['stop', '--data-dir', dataDir, '--json']);
  const packageRoot = path.join(prefix, 'lib/node_modules/lumasite');
  const { createWebsite } = await import(pathToFileURL(path.join(packageRoot, 'src/create.mjs')));
  const [appPort, appSitePort] = await ports();
  const created = await createWebsite(app, { yes: true, name: 'Created website', file: websiteZip, port: String(appPort), 'site-port': String(appSitePort), 'data-dir': 'private data' }, { packageSpec: `file:${path.join(directory, archive.filename)}`, output: { write() {} }, errors: { write() {} } });
  assert.equal(created.healthy, true); assert.equal(created.projectDir, app); assert.equal(created.commands.start, 'npm start');
  const appPackage = JSON.parse(await fs.readFile(path.join(app, 'package.json'), 'utf8'));
  assert.equal(appPackage.scripts.start, 'node lumasite.mjs start');
  assert.equal(appPackage.scripts.detect, 'node lumasite.mjs detect');
  assert.ok(await fs.stat(path.join(app, 'package-lock.json')));
  await assert.rejects(fs.access(path.join(app, '.setup-import.zip')), { code: 'ENOENT' });
  const runRecord = JSON.parse(await fs.readFile(path.join(app, 'private data/run.json')));
  assert.equal(runRecord.serverPath, await fs.realpath(path.join(app, 'node_modules/lumasite/src/server.mjs')));
  assert.match(await fs.readFile(path.join(app, '.gitignore'), 'utf8'), /\/private\\ data\//);
  await fs.rm(prefix, { recursive: true, force: true });
  assert.equal(JSON.parse((await run(process.execPath, [path.join(app, 'lumasite.mjs'), 'health', '--json'])).stdout).status, 'healthy', 'Created project survives removal of temporary installer');
  assert.equal((await fetch(`http://127.0.0.1:${appPort}/admin`)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${appSitePort}/sites/${created.projects[0].slug}/`)).status, 200, 'Creator imports published website revisions');
  assert.equal(JSON.parse((await run(process.execPath, [path.join(app, 'lumasite.mjs'), 'detect', '--json'])).stdout).ports.length, 2);
  console.log(JSON.stringify({ package: archive.name, version: archive.version, files: files.length, bytes: archive.size, globalInstall: 'passed', setup: 'passed', studio: 'passed', publish: 'passed', mcp: 'passed', oauth: 'passed', update: 'passed', delete: 'passed', recovery: 'passed', create: 'passed', independentRuntime: 'passed' }));
} finally {
  await run(process.execPath, [path.join(app, 'lumasite.mjs'), 'stop', '--json']).catch(() => {});
  await run(bin, ['stop', '--data-dir', dataDir, '--json']).catch(() => {});
  await fs.rm(directory, { recursive: true, force: true });
}
