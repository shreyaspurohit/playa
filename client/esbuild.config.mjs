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

// Downloadable semantic-search backend (ADR 21): a SEPARATE ESM chunk holding
// @huggingface/transformers + @orama/orama. NOT inlined — the Python builder
// copies it next to index.html as `semantic-backend.js`, and the main bundle
// imports it at runtime only when the user opts into the ~35 MB model download.
// Keeps the embedding/search libs out of the main bundle every other user loads.
// onnxruntime-node + sharp are Node-only transformers.js deps → externalized.
const semanticConfig = {
  entryPoints: ['src/assistant/semantic.ts'],
  bundle: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  format: 'esm',
  target: ['es2020'],
  platform: 'browser',
  outfile: 'dist/semantic-backend.js',
  legalComments: 'none',
  external: ['onnxruntime-node', 'sharp'],
  banner: {
    js: banner([
      ['@huggingface/transformers', 'node_modules/@huggingface/transformers/LICENSE'],
      ['orama', 'node_modules/@orama/orama/LICENSE.md'],
    ]),
  },
  logLevel: 'info',
};

if (watch) {
  for (const cfg of [mainConfig, semanticConfig]) {
    const ctx = await esbuild.context(cfg);
    await ctx.watch();
  }
  console.log('[esbuild] watching for changes…');
} else {
  for (const cfg of [mainConfig, semanticConfig]) {
    const result = await esbuild.build(cfg);
    console.log(`[esbuild] built ${cfg.outfile} (errors: ${result.errors.length}, warnings: ${result.warnings.length})`);
  }
}
