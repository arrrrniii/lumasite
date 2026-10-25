// Prepare explicit assignments for a reviewed legacy prefix-based website.
// This module does not read credentials or write state.
export function prefixedLanguageAssignments(pages, locales, defaultLocale = 'en') {
  const bySlug = new Map(pages.map(p => [p.slug, p]));
  const assignments = new Map();
  const groups = new Map();
  const groupBases = new Map();
  const translated = locales.filter(l => l.code !== defaultLocale);
  function add(page, locale, translationKey) {
    if (page.translationKey && (page.translationKey !== translationKey || page.locale !== locale)) throw new Error(`Review the existing assignment for /${page.slug}.`);
    const value = { pageId: page.id, expectedRevision: page.revision, locale, translationKey };
    const existing = assignments.get(page.id);
    if (existing && (existing.locale !== locale || existing.translationKey !== translationKey)) throw new Error(`Conflicting assignments for /${page.slug}.`);
    assignments.set(page.id, value);
  }
  for (const page of pages) {
    const language = translated.find(l => page.slug === l.code.toLowerCase() || page.slug.startsWith(`${l.code.toLowerCase()}/`));
    if (!language) continue;
    const suffix = page.slug.slice(language.code.length).replace(/^\//, '');
    const base = bySlug.get(suffix);
    if (!base) throw new Error(`No default-language equivalent for /${page.slug}; review its translation key explicitly.`);
    const translationKey = base.translationKey || (suffix || 'home').replaceAll('/', '.');
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(translationKey) || translationKey.length > 100) throw new Error(`Review the translation key for /${base.slug}.`);
    if (groupBases.has(translationKey) && groupBases.get(translationKey) !== base.id) throw new Error(`Multiple base pages map to ${translationKey}; choose their keys explicitly.`);
    groupBases.set(translationKey, base.id);
    add(base, defaultLocale, translationKey);
    add(page, language.code, translationKey);
    if (!groups.has(translationKey)) groups.set(translationKey, [`/${base.slug}`]);
    groups.get(translationKey).push(`/${page.slug}`);
  }
  return { assignments: [...assignments.values()], groups: Object.fromEntries(groups) };
}
