import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fail, publicProject, rememberProjectToken, requirePage, requireProject } from './service.mjs';
import { exportProject } from './migration.mjs';
import { confirmProject, projectFingerprint, assertUnchanged, saveProjectBackup, discardProjectBackup, backupSummary } from './project-backups.mjs';

export async function deleteTranslation(store, projectId, { pageId, expectedRevision, confirmPath }) {
  const state = store.read(), project = requireProject(state, projectId), page = requirePage(state, projectId, pageId);
  if (!page.locale || !page.translationKey) fail(400, 'This page is not a linked translation.');
  if (expectedRevision !== page.revision) fail(409, 'The translation changed. Read page_get before deleting.');
  if (confirmPath !== `/${page.slug}`) fail(400, 'Supply the exact draft URL path, including its leading slash, to confirm deletion.');
  const fingerprint = projectFingerprint(state, projectId);
  const backup = await saveProjectBackup(store, project, await exportProject(store, projectId), 'translation-delete');
  try {
    await store.mutate(next => {
      assertUnchanged(next, projectId, fingerprint);
      next.pages = next.pages.filter(p => p.id !== pageId);
      next.revisions = next.revisions.filter(r => r.pageId !== pageId);
      (next.projectBackups ||= []).push(backup);
      requireProject(next, projectId).updatedAt = new Date().toISOString();
    });
  } catch (error) { await discardProjectBackup(store, backup); throw error; }
  return { status: 'deleted', pageId, locale: page.locale, translationKey: page.translationKey, backup: backupSummary(backup) };
}

export async function deleteProject(store, projectId, options = {}) {
  if (!options || typeof options !== 'object' || Object.keys(options).some(key => key !== 'confirmSlug')) fail(400, 'Use confirmSlug to confirm website deletion.');
  const state = store.read(), project = confirmProject(state, projectId, options.confirmSlug);
  const fingerprint = projectFingerprint(state, projectId);
  const backup = await saveProjectBackup(store, project, await exportProject(store, projectId), 'delete');
  try {
    await store.mutate(next => {
      assertUnchanged(next, projectId, fingerprint);
      next.projects = next.projects.filter(item => item.id !== projectId);
      for (const key of ['pages', 'revisions', 'assets']) next[key] = next[key].filter(item => item.projectId !== projectId);
      (next.projectBackups ||= []).push(backup);
    });
  } catch (error) { await discardProjectBackup(store, backup); throw error; }
  // The active project is already gone. Cleanup failures must not make a
  // successful deletion look like a failed operation that should be retried.
  const warnings = [];
  try { const { purgeFormsProject } = await import('./forms-db.mjs'); purgeFormsProject(path.join(store.dataDir, 'forms.sqlite'), projectId); } catch { warnings.push('Private form data cleanup needs attention on the server.'); }
  try { await rememberProjectToken(store, projectId, null); } catch { warnings.push('Saved credential cleanup needs attention; the deleted MCP endpoint is already disabled.'); }
  try { await rm(path.join(store.dataDir, 'media', projectId), { recursive: true, force: true }); } catch { warnings.push('Old media cleanup needs attention; these files are no longer served.'); }
  return { status: 'deleted', project: publicProject(project), backup: backupSummary(backup), warnings };
}
