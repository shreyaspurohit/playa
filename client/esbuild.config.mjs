// Bundle the Preact client into a single minified IIFE.
// The Python builder (bm_camps/builder.py) reads dist/bundle.js and
// inlines it into the HTML template. No network calls at runtime.
import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

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
