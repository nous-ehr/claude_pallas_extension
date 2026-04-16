import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const options = {
  entryPoints: [
    'src/server.ts',
  ],
  bundle: true,
  outdir: 'dist',
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outExtension: { '.js': '.cjs' },
  sourcemap: true,
  minify: false,
  // Bundle all deps for a zero-dep output
  define: {
    'process.env.NODE_ENV': '"production"',
  },
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.error('[mcp-server] Watching for changes...');
} else {
  await esbuild.build(options);
  console.error('[mcp-server] Build complete → dist/*.js');
}
