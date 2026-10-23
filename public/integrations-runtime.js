// Optional production tags load only after an explicit or saved acceptance.
(() => {
  'use strict';
  const config = document.getElementById('lumasite-optional-tags');
  if (!config) return;
  const { projectId, tags } = JSON.parse(config.textContent);
  const key = `lumasite-consent:${projectId}`, lifetime = 180 * 24 * 60 * 60 * 1000;
  let choice = null, started = false;
  try { const saved = JSON.parse(localStorage.getItem(key)); if (saved && Date.now() - saved.at < lifetime && ['accepted', 'rejected'].includes(saved.choice)) choice = saved.choice; } catch {}
  const host = document.createElement('div'); host.id = 'lumasite-privacy';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = ':host{position:fixed;inset:auto auto 18px 18px;z-index:2147483000;max-width:calc(100vw - 36px);font:14px/1.5 system-ui,sans-serif;color:#edf4ff}*{box-sizing:border-box}section{width:380px;max-width:calc(100vw - 36px);padding:22px;background:#101e35;border:1px solid #354963;border-radius:18px;box-shadow:0 10px 40px #0004}h2{font-size:17px;line-height:1.3;margin:0 0 9px;font-weight:650;color:#fff}p{margin:0 0 17px;color:#c0cede}button{cursor:pointer;font:600 14px/1.3 system-ui,sans-serif;padding:11px 15px;border-radius:9px;border:1px solid #516783;background:#192d49;color:#fff;min-height:40px}button:focus-visible{outline:3px solid #a4c9ff;outline-offset:3px}button[data-choice=accepted]{background:#3477ef;border-color:#3477ef}.actions{display:flex;gap:9px;flex-wrap:wrap}.settings{font-size:12px;padding:8px 12px;background:#101e35;color:#d2e2f7;min-height:34px}';
  shadow.append(style); document.body.append(host);

  function announce() { window.dispatchEvent(new CustomEvent('lumasite:consent', { detail: { choice } })); }
  async function insert(node, target, before) {
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'SCRIPT') {
      if (node.type && !['module', 'text/javascript', 'application/javascript'].includes(node.type)) { target.insertBefore(node.cloneNode(true), before); return; }
      const script = document.createElement('script');
      for (const attr of node.attributes) script.setAttribute(attr.name, attr.value);
      script.textContent = node.textContent;
      const wait = node.src && !node.hasAttribute('async') ? new Promise(resolve => { script.addEventListener('load', resolve, { once: true }); script.addEventListener('error', resolve, { once: true }); }) : null;
      if (wait) script.async = false;
      target.insertBefore(script, before); if (wait) await wait;
    } else {
      const clone = node.cloneNode(false); target.insertBefore(clone, before);
      if (node.childNodes?.length) for (const child of [...node.childNodes]) await insert(child, clone, null);
    }
  }
  async function load() {
    if (started) return; started = true;
    const bodyStartAnchor = document.body.firstChild;
    for (const tag of tags) {
      const template = document.createElement('template'); template.innerHTML = tag.code;
      const target = tag.placement === 'head' ? document.head : document.body;
      const before = tag.placement === 'bodyStart' ? bodyStartAnchor : null;
      for (const child of [...template.content.childNodes]) await insert(child, target, before);
    }
  }
  function render(expanded = !choice) {
    for (const child of [...shadow.children]) if (child !== style) child.remove();
    if (!expanded) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'settings'; button.textContent = 'Privacy settings'; button.addEventListener('click', () => render(true)); shadow.append(button); return;
    }
    const panel = document.createElement('section'); panel.setAttribute('aria-label', 'Privacy choices');
    const title = document.createElement('h2'); title.textContent = 'Your privacy choices';
    const text = document.createElement('p'); text.textContent = 'Allow optional analytics and other tags on this website? You can change your choice at any time.';
    const actions = document.createElement('div'); actions.className = 'actions';
    for (const [value, label] of [['accepted', 'Accept optional tags'], ['rejected', 'Reject optional tags']]) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.choice = value; button.textContent = label; button.addEventListener('click', () => choose(value)); actions.append(button);
    }
    panel.append(title, text, actions); shadow.append(panel);
  }
  function choose(value) {
    const reload = started && value === 'rejected'; choice = value;
    try { localStorage.setItem(key, JSON.stringify({ choice, at: Date.now() })); } catch {}
    announce(); render(false);
    if (reload) location.reload(); else if (choice === 'accepted') load();
  }
  window.LumaSiteConsent = Object.freeze({ accept: () => choose('accepted'), reject: () => choose('rejected'), settings: () => render(true), get choice() { return choice; } });
  render(); announce(); if (choice === 'accepted') load();
})();
