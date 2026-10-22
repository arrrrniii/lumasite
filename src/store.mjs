import { mkdir, readFile, rename, open, chmod } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function atomicWrite(filename, contents) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temp = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(contents); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, filename);
  await chmod(filename, 0o600);
}

export async function openStore(directory) {
  const dataDir = path.resolve(directory);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const filename = path.join(dataDir, 'state.json');
  let state;
  try { state = JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Cannot read ${filename}: ${error.message}. Restore a backup; the existing data was not overwritten.`);
    state = { version: 1, instance: null, projects: [], pages: [], revisions: [], assets: [] };
    await atomicWrite(filename, JSON.stringify(state, null, 2));
  }
  if (state.version !== 1 || !Array.isArray(state.projects)) throw new Error('Unsupported or invalid LumaSite data.');
  let queue = Promise.resolve();
  return {
    dataDir,
    read() { return structuredClone(state); },
    mutate(fn) {
      const operation = queue.then(async () => {
        const next = structuredClone(state);
        const result = await fn(next);
        await atomicWrite(filename, JSON.stringify(next, null, 2));
        state = next;
        return structuredClone(result);
      });
      queue = operation.catch(() => {});
      return operation;
    }
  };
}
