import { randomUUID, createHash } from 'node:crypto';
import { mkdir, open, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fail, requireProject } from './service.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const digest = value => createHash('sha256').update(value).digest('hex');
const location = (store, id) => {
  if (!uuid.test(id)) fail(404, 'Recovery ZIP not found.');
  return path.join(store.dataDir, 'project-backups', `${id}.zip`);
};

export function projectFingerprint(state, projectId) {
  return digest(JSON.stringify({ project: requireProject(state, projectId), ...Object.fromEntries(
    ['pages', 'revisions', 'assets'].map(key => [key, state[key].filter(item => item.projectId === projectId)])
  ) }));
}

export function confirmProject(state, projectId, confirmSlug) {
  const project = requireProject(state, projectId);
  if (confirmSlug !== project.slug) fail(400, 'Type the exact website slug to confirm this operation.');
  return project;
}

export function assertUnchanged(state, projectId, fingerprint) {
  if (!state.projects.some(project => project.id === projectId) || projectFingerprint(state, projectId) !== fingerprint)
    fail(409, 'This website changed during the operation. Refresh and try again; no content was replaced or deleted.');
}

export async function saveProjectBackup(store, project, archive, reason) {
  const id = randomUUID(), file = location(store, id);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const handle = await open(file, 'wx', 0o600);
  try { await handle.writeFile(archive.buffer); await handle.sync(); }
  catch (error) { await handle.close(); await rm(file, { force: true }); throw error; }
  await handle.close();
  return { id, projectId: project.id, name: project.name, slug: project.slug, domain: project.domain,
    reason, createdAt: new Date().toISOString(), filename: `${project.slug}-before-${reason}-${id}.zip`,
    bytes: archive.buffer.length, sha256: digest(archive.buffer) };
}

export const backupSummary = record => ({ ...record, download: `/api/project-backups/${record.id}/download` });
export const discardProjectBackup = (store, record) => rm(location(store, record.id), { force: true });
export function listProjectBackups(store) { return (store.read().projectBackups || []).map(backupSummary).reverse(); }

export async function readProjectBackup(store, id) {
  const file = location(store, id), record = (store.read().projectBackups || []).find(item => item.id === id);
  if (!record) fail(404, 'Recovery ZIP not found.');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== record.bytes) fail(409, 'Recovery ZIP is missing or changed.');
    const buffer = await handle.readFile();
    if (digest(buffer) !== record.sha256) fail(409, 'Recovery ZIP integrity check failed.');
    return { ...record, buffer };
  } finally { await handle.close(); }
}
