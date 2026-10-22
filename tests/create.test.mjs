import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { PassThrough } from 'node:stream';
import { createWebsite } from '../src/create.mjs';
const missing = file => assert.rejects(fs.access(file), { code: 'ENOENT' });

async function fixture(t) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'create-lumasite-'));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  return cwd;
}

test('creator preserves an existing project directory and rejects data inside dependencies', async t => {
  const cwd = await fixture(t), directory = path.join(cwd, 'existing');
  await fs.mkdir(directory); await fs.writeFile(path.join(directory, 'keep.txt'), 'original');
  await assert.rejects(createWebsite('existing', { yes: true, name: 'New website' }, { cwd }), /directory already exists/);
  assert.equal(await fs.readFile(path.join(directory, 'keep.txt'), 'utf8'), 'original');
  for (const location of ['.', '..', 'node_modules', 'node_modules/data', path.parse(cwd).root]) {
    await assert.rejects(createWebsite('new-website', { yes: true, name: 'Website', 'data-dir': location }, { cwd }), /dedicated data directory/);
    await missing(path.join(cwd, 'new-website'));
  }
});

test('creator refuses unattended prompting before installing packages or creating files', async t => {
  const cwd = await fixture(t), input = new PassThrough(), output = new PassThrough();
  await assert.rejects(createWebsite(undefined, {}, { cwd, input, output }), /needs a terminal/);
  await assert.rejects(createWebsite(undefined, { yes: true }, { cwd, input, output }), /requires a project directory/);
  assert.deepEqual(await fs.readdir(cwd), []);
});

test('first-run creator asks the project name, collects setup answers, and cancels without files', { timeout: 10000 }, async t => {
  const cwd = await fixture(t), input = new PassThrough(), output = new PassThrough();
  input.isTTY = true; output.isTTY = true;
  const listeners = await Promise.all([0, 1].map(() => new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => resolve(server)); })));
  const ports = listeners.map(server => server.address().port);
  await Promise.all(listeners.map(server => new Promise(resolve => server.close(resolve))));
  const steps = [
    ['What is your project named?', 'my-website'], ['Import a website ZIP', ''],
    ['Website name', ''], ['Website domain', ''], ['Studio URL', ''], ['Preview URL', ''], ['Create this instance', 'n'],
  ];
  let index = 0, transcript = '';
  output.on('data', bytes => {
    const value = bytes.toString(); transcript += value;
    if (value.includes(steps[index]?.[0])) { const answer = steps[index++][1]; setImmediate(() => input.write(`${answer}\n`)); }
  });
  const result = await createWebsite(undefined, { mode: 'local', 'no-start': true, port: String(ports[0]), 'site-port': String(ports[1]) }, { cwd, input, output });
  assert.equal(result, null); assert.match(transcript, /Website name \[my-website\]/);
  assert.equal(index, steps.length); assert.deepEqual(await fs.readdir(cwd), []);
  input.destroy(); output.destroy();
});
