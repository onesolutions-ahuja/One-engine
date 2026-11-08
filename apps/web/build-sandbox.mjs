import { build } from 'esbuild';
await build({
  entryPoints: ['src/core/components/ComponentSandbox/component-sandbox-frame.tsx'],
  outfile: 'public/component-sandbox.js',
  platform: 'browser',
  format: 'iife',
  bundle: true,
  minify: true,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});
