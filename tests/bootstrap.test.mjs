import test from 'node:test';
import assert from 'node:assert/strict';
import { launchCli } from '../src/bootstrap.mjs';

function capture() {
  let output = '', errors = '';
  return { stdout: { write(text) { output += text; } }, stderr: { write(text) { errors += text; } }, result: () => ({ output, errors }) };
}

test('unsupported Node exits with actionable output before loading any application dependencies', async () => {
  for (const nodeVersion of ['18.20.8', '20.19.5', '22.16.0']) {
    const streams = capture(); let loaded = false;
    const code = await launchCli(['create'], { ...streams, nodeVersion, load: async () => { loaded = true; throw new Error('Should not load'); } });
    assert.equal(code, 1); assert.equal(loaded, false);
    assert.match(streams.result().errors, /Node\.js 24 or later is required/);
    assert.match(streams.result().errors, new RegExp(nodeVersion.replaceAll('.', '\\.')));
    assert.match(streams.result().errors, /Updating npm does not update Node/);
    assert.equal(streams.result().output, '');
  }
});

test('startup failures and version checks preserve JSON error output for automation', async () => {
  const unsupported = capture();
  assert.equal(await launchCli(['create', '--json'], { ...unsupported, nodeVersion: '20.19.5' }), 1);
  assert.match(JSON.parse(unsupported.result().errors).error, /24 or later/);
  const failedImport = capture();
  assert.equal(await launchCli(['--json'], { ...failedImport, nodeVersion: '24.0.0', load: async () => { throw new Error('Missing dependency'); } }), 1);
  assert.match(JSON.parse(failedImport.result().errors).error, /Could not start the CLI: Missing dependency/);
});

test('supported runtimes forward arguments, streams, and exit status to the CLI', async () => {
  const streams = capture(), args = ['create', 'my-website'];
  const result = await launchCli(args, { ...streams, nodeVersion: '24.13.0', load: async () => ({ runCli: async (received, options) => { assert.deepEqual(received, args); assert.equal(options.stdout, streams.stdout); assert.equal(options.stderr, streams.stderr); options.stdout.write('wizard'); return 130; } }) });
  assert.equal(result, 130); assert.equal(streams.result().output, 'wizard'); assert.equal(streams.result().errors, '');
});
