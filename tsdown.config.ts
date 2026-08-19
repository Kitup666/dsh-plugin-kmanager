// Bundle the Host TypeScript emit into the package root entries, mirroring the
// monorepo build: tsc emits lib/types, tsdown packs lib/types/{index,invariant}.js
// into lib/{index,invariant}.js, keeping every external import (the @deepseek-ai
// peer seam) as a runtime import. A plain object avoids importing tsdown here.
//
// A second, browser face produces lib/client.js (the `dsh.client` half the
// boot graph fetches): CJS closure factory handed to the window loader, with
// the standard kit (react + harness client modules) resolved through the
// injected require as externals.
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
]

const client = {
  name: '@deepseek-ai/dsh-plugin-kmanager/client',
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: ['cjs'],
  platform: 'browser',
  target: 'es2024',
  dts: false,
  clean: false,
  sourcemap: true,
  external: CLIENT_EXTERNALS,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: "@deepseek-ai/dsh-plugin-kmanager", factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [
  {
    entry: ['lib/types/index.js', 'lib/types/invariant.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  client,
]