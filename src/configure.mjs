// Configuration migration is deliberately separate from content and credentials.
const settingNames = ['public-url', 'site-url', 'host', 'port', 'site-port', 'domain'];
const listenerHosts = new Set(['127.0.0.1', '0.0.0.0', '::1']);

function origin(value, label) {
  if (typeof value !== 'string' || !/^https?:\/\/[^/?#\s]+\/?$/i.test(value.trim()) || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} must be an HTTP(S) origin without credentials, a path, query or fragment.`);
  }
  let parsed;
  try { parsed = new URL(value.trim()); } catch { throw new Error(`${label} must be a valid HTTP(S) origin.`); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`${label} must be an HTTP(S) origin without credentials, a path, query or fragment.`);
  }
  return parsed.origin;
}
function port(value, label) {
  const source = String(value);
  if (!/^\d+$/.test(source) || !Number.isSafeInteger(Number(source)) || Number(source) < 1 || Number(source) > 65535) {
    throw new Error(`${label} must be an integer between 1 and 65535.`);
  }
  return Number(source);
}
function domainName(value) {
  let domain = String(value).trim().toLowerCase().replace(/\.$/, '');
  if (domain.includes('://')) {
    // Match the existing service's hostname normalization, with explicit HTTP(S).
    const parsed = new URL(origin(domain, 'Project domain'));
    if (parsed.port) throw new Error('Project domain must not include a port.');
    domain = parsed.hostname.replace(/\.$/, '');
  }
  if (domain.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)) {
    throw new Error('Project domain must be a valid hostname, such as example.com.');
  }
  return domain;
}

/** Validate without writing. Values omitted by the caller are preserved. */
export function prepareConfiguration(state, options = {}) {
  if (!state.instance) throw new Error('Initialize this LumaSite instance before configuring it.');
  if (!settingNames.some(name => options[name] !== undefined)) throw new Error('Configure requires at least one setting: --public-url, --site-url, --host, --port, --site-port or --domain.');
  if (options.project !== undefined && options.domain === undefined) throw new Error('--project selects the project for --domain; use these options together.');
  const current = state.instance;
  const instance = {
    ...current,
    publicUrl: origin(options['public-url'] ?? current.publicUrl, 'Administrator public URL'),
    sitePublicUrl: origin(options['site-url'] ?? current.sitePublicUrl ?? `http://localhost:${current.sitePort}`, 'Website public URL'),
    host: options.host ?? current.host,
    port: port(options.port ?? current.port, 'Administrator port'),
    sitePort: port(options['site-port'] ?? current.sitePort, 'Website port'),
  };
  if (!listenerHosts.has(instance.host)) throw new Error('Listener host must be 127.0.0.1, 0.0.0.0 or ::1.');
  if (instance.port === instance.sitePort) throw new Error('Administrator and website ports must be different.');
  if (instance.publicUrl === instance.sitePublicUrl) throw new Error('Administrator and website public URLs must use different origins.');
  let project = null;
  if (options.domain !== undefined) {
    if (options.project !== undefined) {
      const matches = state.projects.filter(project => project.id === options.project || project.slug === options.project);
      if (matches.length !== 1) throw new Error(matches.length ? 'Project selector is ambiguous. Use the exact project ID.' : 'Project not found. Use its exact ID or slug.');
      project = matches[0];
    } else {
      if (state.projects.length !== 1) throw new Error(state.projects.length ? 'Multiple projects exist. Choose --project ID_OR_SLUG with --domain.' : 'Create a project before assigning --domain.');
      project = state.projects[0];
    }
    const domain = domainName(options.domain);
    if (state.projects.some(other => other.id !== project.id && other.domain === domain)) throw new Error('That domain already belongs to another project.');
    project = { id: project.id, domain };
  }
  return { instance, project };
}

/** Called only after the CLI holds its lifecycle lock and verifies stopped state. */
export async function applyConfiguration(store, options) {
  await store.mutate(state => {
    const changes = prepareConfiguration(state, options);
    state.instance = changes.instance;
    if (changes.project) state.projects.find(project => project.id === changes.project.id).domain = changes.project.domain;
  });
  return store.read();
}
