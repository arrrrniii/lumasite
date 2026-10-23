/* Native form enhancement. Submissions stay server-side; no SMTP settings enter the browser. */
(() => {
  function randomId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
    const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  for (const form of document.querySelectorAll('form[data-lumasite-form]')) {
    if (form.dataset.lumasiteReady) continue;
    form.dataset.lumasiteReady = 'true';
    let requestId;
    form.addEventListener('input', () => { requestId = undefined; });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.reportValidity() || form.dataset.submitting) return;
      const endpoint = new URL(form.action, location.href);
      const status = form.querySelector('[data-form-status]');
      const message = text => { if (status) status.textContent = text; };
      if (endpoint.origin !== location.origin || !/^\/forms\/[a-f0-9-]+\/[a-f0-9-]+$/.test(endpoint.pathname)) { message('This form endpoint is invalid.'); return; }
      const fields = {}, data = new FormData(form);
      for (const [key, value] of data) if (!key.startsWith('_lumasite_') && typeof value === 'string') fields[key] = value;
      for (const input of form.querySelectorAll('input[type="checkbox"][name]')) fields[input.name] = input.checked;
      requestId ||= randomId();
      const buttons = [...form.querySelectorAll('[type="submit"]')], disabled = buttons.map(b => b.disabled);
      form.dataset.submitting = 'true'; buttons.forEach(b => { b.disabled = true; }); message('Sending…');
      try {
        const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, credentials: 'omit', signal: AbortSignal.timeout(20000), body: JSON.stringify({ fields, _lumasite_hp: data.get('_lumasite_hp') || '', idempotencyKey: requestId }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not submit. Please try again.');
        form.reset(); requestId = undefined; message(result.message || 'Thank you. Your message has been received.');
        form.dispatchEvent(new CustomEvent('lumasite:submitted', { bubbles: true, detail: { id: result.id } }));
      } catch (error) { message(error.name === 'TimeoutError' ? 'The request timed out. Please try again.' : error.message || 'Could not submit. Please try again.'); }
      finally { delete form.dataset.submitting; buttons.forEach((b, i) => { b.disabled = disabled[i]; }); }
    });
  }
})();
