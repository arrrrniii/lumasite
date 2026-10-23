import { parseFragment } from 'parse5';
import { escapeHtml } from './templates.mjs';

// The project path is useful on the shared preview origin. On the project's
// own domain it is an alias for the root, including for older ZIP imports.
export function projectRootPath(pathname, slug) {
  const prefix = `/sites/${slug}`;
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null;
  const result = pathname.slice(prefix.length) || '/';
  // Never turn a malformed project path into a protocol-relative redirect.
  if (!/^\/(?!\/)/.test(result) || /[\\\u0000-\u0020\u007f]|%5c|%0[ad]/i.test(result)) return null;
  return result;
}

export function productionLink(value, project, instance = {}) {
  if (!project.domain || !value || /[\\\u0000-\u0020\u007f]/.test(value)) return value;
  const origins = new Set([`https://${project.domain}`, `http://${project.domain}`]);
  if (instance.sitePublicUrl) origins.add(new URL(instance.sitePublicUrl).origin);
  // Root-relative links and explicit links to this installation are eligible.
  // External websites, other projects, fragment links and application URLs stay
  // exactly as authored. A link's query and fragment survive the conversion.
  if (!value.startsWith('/') && !/^https?:\/\//i.test(value)) return value;
  let url;
  try { url = new URL(value, `https://${project.domain}`); } catch { return value; }
  if (!origins.has(url.origin) || url.username || url.password) return value;
  const root = projectRootPath(url.pathname, project.slug);
  return root === null ? value : `${root}${url.search}${url.hash}`;
}

export function productionNavigation(html, project, instance) {
  // Parse for source locations, then edit only navigation attributes. Avoid
  // serializing the tree: scripts, SVG, whitespace and editable source remain
  // byte-for-byte intact, and strings inside scripts/comments are not links.
  const tree = parseFragment(html, { sourceCodeLocationInfo: true, scriptingEnabled: false });
  const edits = [], nodes = [tree];
  while (nodes.length) {
    const node = nodes.pop();
    for (const child of node.childNodes || []) nodes.push(child);
    if (node.content) nodes.push(node.content);
    const attribute = ['a', 'area'].includes(node.tagName) ? 'href'
      : node.tagName === 'form' ? 'action' : ['button', 'input'].includes(node.tagName) ? 'formaction' : null;
    if (!attribute) continue;
    const attr = node.attrs?.find(item => item.name === attribute && !item.namespace);
    const location = node.sourceCodeLocation?.attrs?.[attribute];
    if (!attr || !location) continue;
    const value = productionLink(attr.value, project, instance);
    if (value !== attr.value) edits.push({ ...location, replacement: `${attribute}="${escapeHtml(value)}"` });
  }
  for (const edit of edits.sort((a, b) => b.startOffset - a.startOffset)) {
    html = html.slice(0, edit.startOffset) + edit.replacement + html.slice(edit.endOffset);
  }
  return html;
}
