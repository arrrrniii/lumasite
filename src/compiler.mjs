import { compile } from 'tailwindcss';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let compilerPromise;

function getCompiler() {
  compilerPromise ??= compile('@import "tailwindcss";', {
    async loadStylesheet(id, base) {
      const filename = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css') : path.resolve(base, id);
      return { path: filename, base: path.dirname(filename), content: await readFile(filename, 'utf8') };
    }
  });
  return compilerPromise;
}

// A fresh compiler per publication prevents unrelated project classes from leaking
// into another site's CSS. The compiler's build() method is additive.
export async function compilePageCss(html, customCss = '', javascript = '') {
  const compiler = await compile('@import "tailwindcss";', {
    async loadStylesheet(id, base) {
      const filename = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css') : path.resolve(base, id);
      return { path: filename, base: path.dirname(filename), content: await readFile(filename, 'utf8') };
    }
  });
  const candidates = new Set();
  for (const match of html.matchAll(/\bclass\s*=\s*["']([^"']*)["']/gi)) {
    for (const token of match[1].split(/\s+/)) if (token) candidates.add(token);
  }
  // Also support literal class names introduced by classList and native scripts.
  for (const match of javascript.matchAll(/["'`]([^"'`\n]{1,300})["'`]/g)) {
    for (const token of match[1].split(/\s+/)) if (/^[\w:[\].#%/!()=,+-]+$/.test(token)) candidates.add(token);
  }
  const css = compiler.build([...candidates]);
  return `${css}\n/* LumaSite page styles */\n${customCss}`;
}

export async function compilerHealth() { await getCompiler(); return true; }
