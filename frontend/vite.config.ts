// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    // bb.js v0.50 + @noir-lang/noir_js ship with a native Web Worker that
    // fetches its own WASM from a relative path. Vite's dep-optimizer
    // (esbuild) bundles them into a single chunk and rewrites the
    // worker's `import.meta.url`, which then resolves to a non-existent
    // asset — the dev server replies with the SPA HTML fallback
    // ("\n   <!doctype html>...") and `WebAssembly.instantiate` chokes on
    // it (`expected magic word 00 61 73 6d, found 0a 20 20 20`).
    // Excluding these packages from optimizeDeps keeps Vite from
    // pre-bundling them so the worker can resolve its own assets.
    optimizeDeps: {
      exclude: [
        "@aztec/bb.js",
        "@noir-lang/noir_js",
        "@noir-lang/acvm_js",
        "@noir-lang/noirc_abi",
        "@noir-lang/types",
      ],
    },
    // bb.js uses SharedArrayBuffer internally (multi-threaded mode).
    // Browsers gate that behind cross-origin isolation, which requires
    // these two headers on the dev server. They are also needed in
    // production if we ever self-host the built bundle.
    server: {
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
    },
  },
});
