/**
 * Copy @aztec/bb.js's browser build into public/vendor/bb/.
 *
 * bb.js spawns its wasm worker with
 *   new Worker(new URL(/* webpackIgnore *\/ './main.worker.js', import.meta.url))
 * The `webpackIgnore` means the bundler neither rewrites that URL nor emits the
 * worker, so once bb.js is bundled into a hashed chunk the worker resolves to a
 * `/_next/static/chunks/main.worker.js` that does not exist and proving hangs
 * forever with no error. Serving `dest/browser/` intact at a stable path lets
 * `import.meta.url`-relative resolution find its sibling worker and wasm files.
 *
 * lib/bb-loader.ts then loads it as native ESM, bypassing webpack entirely.
 *
 * Adapted from scripts/vendor-bb.mjs in the confidential-token demo, which uses
 * pnpm; this resolves through npm's flat node_modules instead.
 */
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");

const src = join(webRoot, "node_modules", "@aztec", "bb.js", "dest", "browser");
const dest = join(webRoot, "public", "vendor", "bb");

if (!existsSync(src)) {
  console.error(`vendor-bb: no bb.js browser build at ${src}`);
  console.error("vendor-bb: run `npm install` first");
  process.exit(1);
}

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });

console.log(`vendor-bb: ${src} -> public/vendor/bb/`);
