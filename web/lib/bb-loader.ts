/**
 * Browser loader for bb.js, the UltraHonk proving backend behind confidential
 * transfers.
 *
 * `scripts/vendor-bb.mjs` copies bb.js's `dest/browser/` verbatim into
 * `public/vendor/bb/`, and this loads it as a NATIVE ES module from there
 * rather than letting webpack bundle it. bb.js resolves its wasm Web Worker
 * relative to `import.meta.url`:
 *
 *     new Worker(new URL('./main.worker.js', import.meta.url))   // webpackIgnore
 *
 * Bundling moves `index.js` into a hashed `_next` chunk whose sibling
 * `main.worker.js` does not exist, so the worker never starts and proving hangs
 * with no error at all — the worst kind of failure to debug. Served from
 * `/vendor/bb/index.js`, `import.meta.url` points at a real directory where the
 * worker and wasm files are still next to it.
 *
 * `nativeImport` goes through `new Function` so webpack never sees an `import()`
 * it might rewrite. It is built lazily inside the callback because this module
 * is reachable from the SSR bundle even though proving only ever runs in the
 * browser.
 *
 * Ported from the confidential-token demo's `lib/bb-loader.ts`.
 */
import { setUltraHonkBackendLoader } from "@ctd/sdk";

let nativeImport: ((url: string) => Promise<Record<string, unknown>>) | undefined;

function getNativeImport(): (url: string) => Promise<Record<string, unknown>> {
  nativeImport ??= new Function("url", "return import(url)") as (
    url: string
  ) => Promise<Record<string, unknown>>;
  return nativeImport;
}

const BB_URL = "/vendor/bb/index.js";

let registered = false;

/** Point the SDK prover at the native-ESM bb.js. Idempotent; browser-only. */
export function ensureBrowserBackend(): void {
  if (registered || typeof window === "undefined") return;
  registered = true;
  setUltraHonkBackendLoader(async () => {
    const mod = await getNativeImport()(BB_URL);
    return mod.UltraHonkBackend as never;
  });
}
