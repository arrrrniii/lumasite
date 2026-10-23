// Keep startup dependency-free so unsupported runtimes get a useful error before SDK imports.
export async function launchCli(args, { nodeVersion = process.versions.node, stdout = process.stdout, stderr = process.stderr, load = () => import('./cli.mjs') } = {}) {
  const report = message => {
    stderr.write(args.includes('--json') ? JSON.stringify({ error: message }) + '\n' : `LumaSite: ${message}\n`);
    return 1;
  };
  const major = Number(String(nodeVersion).split('.')[0]);
  if (!Number.isInteger(major) || major < 24) return report(`Node.js 24 or later is required; found v${nodeVersion}. Updating npm does not update Node.js. Select Node 24 (for example: nvm install 24, then nvm use 24), then retry this command.`);
  try {
    const { runCli } = await load();
    return await runCli(args, { stdout, stderr });
  } catch (error) {
    return report(`Could not start the CLI: ${error?.message || String(error)}. Check the installation and run again with Node.js 24 or later.`);
  }
}
