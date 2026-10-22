import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../src/store.mjs';
import { initializeInstance, createProject, createPage, updatePage, publishPage, restorePage, tokenMatches } from '../src/service.mjs';

async function fixture(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'lumasite-service-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = await openStore(dataDir);
  await initializeInstance(store);
  return { dataDir, store };
}

test('concurrent project creation preserves every recoverable project token', async t => {
  const { dataDir, store } = await fixture(t);
  const created = await Promise.all(Array.from({ length: 30 }, (_, i) => createProject(store, { name: `Concurrent project ${i}` })));
  const credentials = JSON.parse(await readFile(path.join(dataDir, 'credentials.json'), 'utf8'));
  assert.equal(store.read().projects.length, 30);
  assert.equal(Object.keys(credentials.projectTokens).length, 30);
  for (const { project, token } of created) {
    assert.equal(credentials.projectTokens[project.id], token);
    assert.equal(tokenMatches(credentials.projectTokens[project.id], store.read().projects.find(p => p.id === project.id).tokenHash), true);
  }
});

test('publishing rejects live path collisions until the previous page releases its route', async t => {
  const { store } = await fixture(t);
  const { project } = await createProject(store, { name: 'Routes' });
  const home = store.read().pages.find(p => p.projectId === project.id);
  const first = await publishPage(store, project.id, home.id);
  await updatePage(store, project.id, home.id, { slug: 'moved', html: '<h1>Moved home</h1>' });
  const replacement = await createPage(store, project.id, { title: 'Replacement home', slug: '', html: '<h1>New home</h1>' });

  await assert.rejects(publishPage(store, project.id, replacement.id), { status: 409 });
  let snapshot = store.read();
  assert.equal(snapshot.pages.find(p => p.id === replacement.id).publishedRevisionId, null);
  assert.equal(snapshot.pages.find(p => p.id === home.id).publishedRevisionId, first.revision.id);

  await publishPage(store, project.id, home.id);
  await publishPage(store, project.id, replacement.id);
  snapshot = store.read();
  const livePaths = snapshot.pages.filter(p => p.projectId === project.id && p.publishedRevisionId).map(p => snapshot.revisions.find(r => r.id === p.publishedRevisionId).page.slug);
  assert.deepEqual(livePaths.sort(), ['', 'moved']);
});

test('restoring a revision restores its slug and full page fields but rejects draft path conflicts', async t => {
  const { store } = await fixture(t);
  const { project } = await createProject(store, { name: 'Restoration' });
  const home = store.read().pages.find(p => p.projectId === project.id);
  const original = await updatePage(store, project.id, home.id, {
    title: 'Original home', description: 'Original description', slug: '',
    html: '<h1>Original</h1>', css: 'h1{color:blue}', js: 'window.original=true;',
  });
  const first = await publishPage(store, project.id, home.id);
  await updatePage(store, project.id, home.id, {
    title: 'Moved draft', description: 'Changed description', slug: 'moved',
    html: '<h1>Changed</h1>', css: 'h1{color:red}', js: 'window.original=false;',
  });
  const moved = await publishPage(store, project.id, home.id);
  const conflicting = await createPage(store, project.id, { title: 'Reserved root', slug: '', html: '<p>Reserved</p>' });
  await assert.rejects(restorePage(store, project.id, home.id, first.revision.id), { status: 409 });
  assert.equal(store.read().pages.find(p => p.id === home.id).slug, 'moved');

  await updatePage(store, project.id, conflicting.id, { slug: 'another-page' });
  const before = store.read().pages.find(p => p.id === home.id);
  const restored = await restorePage(store, project.id, home.id, first.revision.id);
  for (const key of ['title', 'description', 'slug', 'html', 'css', 'js']) assert.equal(restored[key], original[key], `${key} is restored`);
  assert.equal(restored.revision, before.revision + 1);
  assert.equal(restored.publishedRevisionId, moved.revision.id, 'Restore changes the draft without replacing the live revision');
  const snapshot = store.read();
  assert.equal(snapshot.revisions.find(r => r.id === moved.revision.id).page.slug, 'moved');
  assert.equal(snapshot.revisions.find(r => r.id === first.revision.id).page.slug, '');
});

test('page paths cannot shadow server routes on a project domain', async t => {
  const { store } = await fixture(t);
  const { project } = await createProject(store, { name: 'Reserved routes' });
  for (const slug of ['health', 'runtime/lumafx', 'media/my-file', 'release-assets/file', 'preview-assets/file', 'preview/page', 'sites/another-project', 'admin', 'api/projects', 'mcp/project']) {
    await assert.rejects(createPage(store, project.id, { title: 'Reserved', slug }), { status: 400 }, slug);
  }
  const pricing = await createPage(store, project.id, { title: 'Pricing', slug: 'pricing' });
  await assert.rejects(updatePage(store, project.id, pricing.id, { slug: 'health' }), { status: 400 });
  assert.equal(store.read().pages.find(p => p.id === pricing.id).slug, 'pricing');
});
