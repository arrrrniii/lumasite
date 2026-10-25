import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { prefixedLanguageAssignments } from '../src/legacy-locales.mjs';

const args = process.argv.slice(2);
const value = flag => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
if (!value('--data-dir') || !value('--project')) throw new Error('Usage: node scripts/adopt-prefixed-pages.mjs --data-dir /absolute/private/data --project ID_OR_SLUG [--apply]');
const dataDir = path.resolve(value('--data-dir'));
const disk = JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8'));
const project = disk.projects.find(p => p.id === value('--project') || p.slug === value('--project'));
if (!project || !disk.instance) throw new Error('Select an initialized project in this data directory.');
const credentials = JSON.parse(await readFile(path.join(dataDir, 'credentials.json'), 'utf8'));
const token = credentials.projectTokens?.[project.id];
if (!token) throw new Error('The existing project token must be available locally. No credentials are changed.');
const client = new Client({ name: 'lumasite-legacy-locale-adoption', version: '1' });
const call = async (name, input = {}) => {
  const result = await client.callTool({ name, arguments: input });
  if (result.isError) throw new Error(`MCP ${name} failed. No retry was attempted; inspect the server result locally.`);
  return result.structuredContent || JSON.parse(result.content[0].text);
};
try {
  // Credentials are sent only to the local installation, never a remote URL.
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${disk.instance.port}/mcp/${project.id}`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  const schema = (await client.listTools()).tools.find(t => t.name === 'languages_update')?.inputSchema;
  if (!schema?.properties?.assignments) throw new Error('Upgrade the running server to the reviewed commit before applying this migration.');
  const current = await call('languages_get');
  const labels = { en: 'English', sq: 'Shqip', it: 'Italiano', de: 'Deutsch' };
  if (current.languages.defaultLocale !== 'en') throw new Error('This migration plan expects English as the existing default language.');
  const locales = current.languages.locales.map(l => ({ ...l }));
  for (const [code, label] of Object.entries(labels)) if (!locales.some(l => l.code === code)) locales.push({ code, label, direction: 'ltr' });
  const plan = prefixedLanguageAssignments(current.pages, locales, 'en');
  if (!plan.assignments.length) throw new Error('No existing language-prefixed pages matched; no changes made.');
  console.log(JSON.stringify({ project: project.slug, domain: project.domain, mode: args.includes('--apply') ? 'apply' : 'dry-run', pageCount: plan.assignments.length, groups: plan.groups }, null, 2));
  if (args.includes('--apply')) {
    const backupDir = path.join(dataDir, 'migration-backups');
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    const backup = path.join(backupDir, `before-language-adoption-${randomUUID()}.json`);
    await writeFile(backup, await readFile(path.join(dataDir, 'state.json')), { mode: 0o600, flag: 'wx' });
    await call('languages_update', { expectedRevision: current.languages.revision, defaultLocale: 'en', locales, assignments: plan.assignments });
    console.log(JSON.stringify({ applied: true, metadataBackup: backup, message: 'Check the initial HTML, reciprocal hreflang and sitemap on the production host. Draft content and existing URLs were preserved.' }));
  }
} finally {
  await client.close();
}
