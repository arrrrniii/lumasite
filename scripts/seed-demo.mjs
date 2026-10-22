import path from 'node:path';
import { openStore } from '../src/store.mjs';
import { initializeInstance, createProject, publishPage, getProjectUrls } from '../src/service.mjs';

const store = await openStore(process.env.LUMASITE_DATA_DIR || path.resolve('.lumasite'));
if (!store.read().instance) await initializeInstance(store);
let project = store.read().projects.find(p => p.slug === 'sendmailos');
if (!project) ({ project } = await createProject(store, { name: 'SendMailOS', domain: 'sendmailos.local' }));
const home = store.read().pages.find(p => p.projectId === project.id && p.slug === '');
if (home && !home.publishedRevisionId) await publishPage(store, project.id, home.id);
console.log(JSON.stringify({ project: project.name, urls: getProjectUrls(store.read(), project), credentials: 'Run node bin/lumasite.mjs credentials to view local credentials.' }, null, 2));
