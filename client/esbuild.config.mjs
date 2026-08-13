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
const licenseBanner = [
  ['Preact', 'node_modules/preact/LICENSE'],
  ['pwa-install', 'node_modules/@khmyznikov/pwa-install/LICENSE'],
  ['Dropbox JavaScript SDK', 'node_modules/dropbox/LICENSE'],
].map(([name, path]) => (
  `===== ${name} =====\n${readFileSync(new URL(path, import.meta.url), 'utf8').trim()}`
)).join('\n\n');

const config = {
  entryPoints: ['src/index.tsx'],
  bundle: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  format: 'iife',
  target: ['es2020'],
  platform: 'browser',
  outfile: 'dist/bundle.js',
  legalComments: 'none',
  banner: { js: `/*! THIRD-PARTY LICENSE NOTICES\n\n${licenseBanner}\n*/` },
  logLevel: 'info',
  // Preact + automatic JSX runtime (matches tsconfig.json).
  jsx: 'automatic',
  jsxImportSource: 'preact',
};

if (watch) {
  const ctx = await esbuild.context(config);
  await ctx.watch();
  console.log('[esbuild] watching for changes…');
} else {
  const result = await esbuild.build(config);
  console.log(`[esbuild] built ${config.outfile} (errors: ${result.errors.length}, warnings: ${result.warnings.length})`);
}
