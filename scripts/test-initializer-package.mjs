// Install both packed public packages together before either is published.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile), root = fileURLToPath(new URL('..', import.meta.url));
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lumasite-initializer-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (file, args, cwd = directory) => exec(file, args, { cwd, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
try {
  const [runtime] = JSON.parse((await run(npm, ['pack', '--json', '--pack-destination', directory], root)).stdout);
  const [initializer] = JSON.parse((await run(npm, ['pack', '--json', '--pack-destination', directory], path.join(root, 'packages/create-lumasite'))).stdout);
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'packages/create-lumasite/package.json')));
  assert.equal(metadata.dependencies.lumasite, runtime.version);
  assert.equal(initializer.version, runtime.version);
  assert.deepEqual(initializer.files.map(file => file.path).sort(), ['README.md', 'bin/create-lumasite.mjs', 'package.json']);
  const install = path.join(directory, 'installed');
  await fs.mkdir(install);
  await fs.writeFile(path.join(install, 'package.json'), '{"private":true}\n');
  await run(npm, ['install', '--prefix', install, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', path.join(directory, runtime.filename), path.join(directory, initializer.filename)]);
  const launcher = path.join(install, 'node_modules/create-lumasite/bin/create-lumasite.mjs');
  assert.equal((await run(process.execPath, [launcher, '--version'])).stdout.trim(), runtime.version);
  assert.match((await run(process.execPath, [launcher, '--help'])).stdout, /Create defaults to server mode/);
  await assert.rejects(run(process.execPath, [launcher, '--yes', '--json']), error => {
    assert.match(JSON.parse(error.stderr).error, /requires a project directory/);
    return true;
  });
  await assert.rejects(run(process.execPath, [launcher, 'conflict', '--local', '--mode', 'server', '--yes', '--json']), error => {
    assert.match(JSON.parse(error.stderr).error, /cannot be combined/);
    return true;
  });
  await assert.rejects(fs.access(path.join(directory, 'conflict')), { code: 'ENOENT' });
  console.log(JSON.stringify({ version: runtime.version, initializer: initializer.name, files: initializer.files.length, installedTogether: 'passed', launcher: 'passed', runtimeVersion: 'passed', errorsBeforeWrites: 'passed' }));
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
