// Bundle the Preact client into a single minified IIFE.
// The Python builder reads dist/bundle.js and inlines it into the HTML
// template. Third-party code is bundled locally; optional Dropbox sync is
// the only feature here that contacts a runtime provider.
import esbuild from 'esbuild';
import { readFileSync } from 'node:fs';

const watch = process.argv.includes('--watch');

// `legalComments: none` keeps duplicate package banners out of the minified
// body, so preserve the complete notices explicitly. This banner rides inside
// the inlined bundle and therefore inside every distributed index.html.
function banner(entries) {
  const body = entries.map(([name, path]) => (
    `===== ${name} =====\n${readFileSync(new URL(path, import.meta.url), 'utf8').trim()}`
  )).join('\n\n');
  return `/*! THIRD-PARTY LICENSE NOTICES\n\n${body}\n*/`;
}

// Main app: single minified IIFE inlined into index.html by the Python builder.
const mainConfig = {
  entryPoints: ['src/index.tsx'],
  bundle: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  format: 'iife',
  target: ['es2020'],
  platform: 'browser',
  outfile: 'dist/bundle.js',
  legalComments: 'none',
  banner: {
    js: banner([
      ['Preact', 'node_modules/preact/LICENSE'],
      ['pwa-install', 'node_modules/@khmyznikov/pwa-install/LICENSE'],
      ['Dropbox JavaScript SDK', 'node_modules/dropbox/LICENSE'],
    ]),
  },
  logLevel: 'info',
  // Preact + automatic JSX runtime (matches tsconfig.json).
  jsx: 'automatic',
  jsxImportSource: 'preact',
};

// Downloadable AI backend (ADR 21 phase 2): a SEPARATE ESM chunk holding
// @mlc-ai/web-llm. NOT inlined — the Python builder copies it next to
// index.html as `webllm-backend.js`, and the main bundle imports it at runtime
// only when the user opts into the model download. Keeps web-llm's ~1-2 MB out
// of the main bundle every non-AI user loads.
const webllmConfig = {
  entryPoints: ['src/assistant/webllm.ts'],
  bundle: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  format: 'esm',
  target: ['es2020'],
  platform: 'browser',
  outfile: 'dist/webllm-backend.js',
  legalComments: 'none',
  banner: { js: banner([['@mlc-ai/web-llm', 'node_modules/@mlc-ai/web-llm/LICENSE']]) },
  logLevel: 'info',
};

if (watch) {
  for (const cfg of [mainConfig, webllmConfig]) {
    const ctx = await esbuild.context(cfg);
    await ctx.watch();
  }
  console.log('[esbuild] watching for changes…');
} else {
  for (const cfg of [mainConfig, webllmConfig]) {
    const result = await esbuild.build(cfg);
    console.log(`[esbuild] built ${cfg.outfile} (errors: ${result.errors.length}, warnings: ${result.warnings.length})`);
  }
}
