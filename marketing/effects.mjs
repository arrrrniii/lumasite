// Keep the requested native LumaFX attributes together for all marketing pages.
function attribute(source, name, value) {
  const pattern = new RegExp(`\\s+${name}=(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'g');
  return `${source.replace(pattern, '')} ${name}="${value}"`;
}

function effects(source, names) {
  const current = source.match(/\sdata-fx="([^"]*)"/)?.[1] || '';
  return attribute(source, 'data-fx', [...new Set([...current.split(/\s+/), ...names])].filter(Boolean).join(' '));
}

export function applyMarketingEffects(html) {
  // Keep readable word boundaries at visual title line breaks.
  const readableTitles = html.replace(/(<h1\b[^>]*>)([\s\S]*?)(<\/h1>)/g,
    (_, open, content, close) => `${open}${content.replace(/<br\s*\/?>\s*/gi, '<br> ')}${close}`);
  return readableTitles.replace(/<(h2|a|div|article|section)\b([^>]*)>/g, (tag, name, source) => {
    if (name === 'h2') {
      source = effects(source, ['shimmer']);
      source = attribute(source, 'data-fx-duration', '4s');
      source = attribute(source, 'data-fx-color', 'var(--site-accent-soft)');
      source = attribute(source, 'data-fx-color-2', 'var(--site-text)');
    } else {
      const classes = new Set((source.match(/\sclass="([^"]*)"/)?.[1] || '').split(/\s+/));
      const largeCard = ['editorial-card', 'platform-card', 'free-offer', 'pricing-plan', 'feature-tile', 'audience-section', 'cta-band'].some(value => classes.has(value));
      const squircle = largeCard || classes.has('photo-hero') || classes.has('visual-panel');
      if (squircle) {
        source = effects(source, largeCard ? ['squircle', 'spotlight'] : ['squircle']);
        source = attribute(source, 'data-fx-radius', classes.has('visual-panel') ? '24px' : '28px');
        source = attribute(source, 'data-fx-smoothing', '0.65');
        source = attribute(source, 'data-fx-fallback', 'radius');
      }
      if (largeCard) {
        source = attribute(source, 'data-fx-color', '#ffb547');
        source = attribute(source, 'data-fx-size', '360px');
      }
    }
    return `<${name}${source}>`;
  });
}
