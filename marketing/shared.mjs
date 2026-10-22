import { applyMarketingEffects } from './effects.mjs';
import { readFileSync } from 'node:fs';
const brandMark = readFileSync(new URL('./assets/brand/sendmailos-mark.svg', import.meta.url), 'utf8').replace('role="img" aria-label="SendMailOS paper plane"', 'aria-hidden="true"');

export const signup = 'https://dash.sendmailos.com/login';
export const docs = 'https://docs.sendmailos.com';

const paths = {
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18"/>',
  workflow: '<rect x="3" y="3" width="6" height="5" rx="1.5"/><rect x="15" y="16" width="6" height="5" rx="1.5"/><path d="M6 8v8a3 3 0 0 0 3 3h6M6 12h9a3 3 0 0 0 3-3V5"/>',
  pixel: '<path d="M4 8V4h4m8 0h4v4m0 8v4h-4M8 20H4v-4"/><path d="M9 9h6v6H9z"/>',
  inbox: '<path d="m5 4-3 9v6a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-6l-3-9H5Z"/><path d="M2 13h6l2 3h4l2-3h6"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m1 3a5 5 0 0 1 4 5v2"/>',
  spark: '<path d="m12 2 2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6L12 2Z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  menu: '<path d="M4 8h16M4 16h16"/>',
};
export function icon(name) { return `<svg class="smo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.mail}</svg>`; }
export function brand() { return `<span class="brand-symbol brand-symbol--plane" aria-hidden="true">${brandMark}</span><span>sendmailos<span class="brand-period">.</span></span>`; }

const productLinks = [
  ['product', 'The whole platform', 'One home for every email.', 'globe'],
  ['campaigns', 'Email campaigns', 'Make your next announcement count.', 'mail'],
  ['automations', 'Automations', 'Thoughtful journeys, on autopilot.', 'workflow'],
  ['pixel', 'Pixel & audiences', 'Turn context into a better next step.', 'pixel'],
  ['inbox', 'Inbox', 'Keep the conversation going.', 'inbox'],
  ['developers', 'API & Template MCP', 'Email, built into your world.', 'code'],
];

export function header(home = false) {
  return `<a class="skip-site" href="#main">Skip to content</a><header class="site-header${home ? ' home-header' : ''}"><a class="site-brand" href="/" aria-label="SendMailOS home">${brand()}</a><nav class="desktop-nav" aria-label="Main navigation"><div class="nav-product"><button type="button" class="nav-trigger" data-product-toggle aria-controls="product-menu" aria-expanded="false">Product ${icon('chevron')}</button><div class="product-menu" id="product-menu" hidden><div class="mega-intro"><span class="eyebrow">A little more connected.</span><h2>One workspace.<br>So many possibilities.</h2><a href="/product" class="text-link">Meet SendMailOS ${icon('arrow')}</a></div><div class="mega-links">${productLinks.map(([slug, title, sub, symbol]) => `<a href="/${slug}"><span>${icon(symbol)}</span><div><strong>${title}</strong><small>${sub}</small></div>${icon('arrow')}</a>`).join('')}</div></div></div><a href="/pricing">Pricing</a><a href="/resources">Resources</a><a href="/blog">Blog</a><a href="${docs}" target="_blank" rel="noopener">Documentation</a></nav><div class="header-actions"><a class="login-link" href="${signup}">Log in</a><a href="${signup}" class="button lime compact" data-fx="press">Start free ${icon('arrow')}</a><button type="button" class="mobile-menu-toggle" data-menu-open aria-label="Open menu" aria-controls="mobile-menu" aria-expanded="false">${icon('menu')}</button></div></header>
  <dialog class="mobile-menu" id="mobile-menu" aria-labelledby="mobile-menu-title"><div class="mobile-menu-head"><a href="/" class="site-brand" aria-label="SendMailOS home">${brand()}</a><button type="button" data-menu-close class="mobile-menu-close" aria-label="Close menu">${icon('close')}</button></div><div class="mobile-menu-content"><div class="mobile-menu-left"><p class="menu-caption" id="mobile-menu-title">A good connection starts here.</p><nav aria-label="Mobile navigation">${[['/', 'Home'], ['/product', 'The platform'], ['/campaigns', 'Campaigns'], ['/automations', 'Automations'], ['/pixel', 'Pixel & audiences'], ['/inbox', 'Inbox'], ['/developers', 'Developers & MCP'], ['/blog', 'Blog'], ['/pricing', 'Pricing']].map(([url, title], i) => `<a href="${url}" style="--menu-index:${i}">${title}<span>${icon('arrow')}</span></a>`).join('')}</nav></div><div class="mobile-menu-right"><span class="menu-orbit" aria-hidden="true">${icon('mail')}</span><p>Good emails.<br>Better connections.</p><a class="button lime" href="${signup}">Start with 3,000 free emails ${icon('arrow')}</a><div class="mobile-menu-bottom"><a href="/resources">Resources</a><a href="/blog">Blog</a><a href="${docs}" target="_blank" rel="noopener">Documentation</a><a href="${signup}">Log in</a></div><small>3,000 emails per month. A little room to grow.</small></div></div></dialog>
  <noscript><nav class="nojs-nav" aria-label="Website navigation"><a href="/product">Product</a><a href="/campaigns">Campaigns</a><a href="/automations">Automations</a><a href="/pixel">Pixel</a><a href="/inbox">Inbox</a><a href="/developers">Developers</a><a href="/pricing">Pricing</a><a href="/resources">Resources</a><a href="/blog">Blog</a><a href="${docs}">Documentation</a></nav></noscript>`;
}

export function footer() {
  return `<footer class="site-footer"><div class="container"><div class="footer-top"><div class="footer-intro"><a href="/" class="site-brand" aria-label="SendMailOS home">${brand()}</a><p>For the announcements.<br>The little follow-ups.<br>The real conversations.</p><a href="${signup}" class="text-link">Make your first connection ${icon('arrow')}</a></div><div class="footer-column"><h2>The platform</h2><a href="/campaigns">Campaigns</a><a href="/automations">Automations</a><a href="/pixel">Pixel & audiences</a><a href="/inbox">Inbox</a><a href="/product">All features</a></div><div class="footer-column"><h2>Build with us</h2><a href="/developers">Email API</a><a href="/developers#template-studio">Template Studio MCP</a><a href="${docs}/guides/smtp" target="_blank" rel="noopener">SMTP</a><a href="${docs}/guides/webhooks" target="_blank" rel="noopener">Webhooks</a><a href="${docs}" target="_blank" rel="noopener">Documentation</a></div><div class="footer-column"><h2>A place to start</h2><a href="/pricing">Pricing</a><a href="/resources">Resources</a><a href="/blog">Blog</a><a href="${docs}/quickstart" target="_blank" rel="noopener">Quickstart</a><a href="${signup}">Your dashboard</a><a href="${signup}">Create an account</a></div></div><div class="footer-statement" aria-hidden="true">Made to connect<span>↗</span></div><div class="footer-bottom"><span>© ${new Date().getUTCFullYear()} SendMailOS. A better place for email.</span><span class="footer-signoff"><i></i> A little more human.</span><a href="#top" data-back-top>Back to top ${icon('arrow')}</a></div></div></footer>`;
}

export function layout(page) {
  const home = !page.slug;
  const content = applyMarketingEffects(page.html);
  return `<div class="marketing-site" data-page="${page.slug || 'home'}" id="top">${header(home)}${content}${footer()}</div>`;
}

export { visual } from './visuals.mjs';
