/**
 * Confidential transfers generate UltraHonk proofs in the browser via bb.js,
 * which needs multithreading → SharedArrayBuffer → cross-origin isolation.
 *
 * COEP is `credentialless` rather than `require-corp` so the page stays
 * cross-origin isolated while `fetch()` can still reach the Soroban RPC without
 * that endpoint having to send CORP headers of its own.
 *
 * The ZK approval path (snarkjs/Groth16) needs none of this — only the
 * confidential-token side pulls bb.js in.
 */
const crossOriginIsolation = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
];

/**
 * `next build` writes to the same `.next` the dev server is serving from, so
 * building while `next dev` runs replaces its chunks and the running page then
 * 404s its own CSS and JS — a white page with dead buttons, and no error to
 * explain it. Builds go to their own directory instead.
 */
const distDir = process.env.NEXT_DIST_DIR || ".next";

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir,
  reactStrictMode: true,
  transpilePackages: ["@ctd/sdk"],
  async headers() {
    return [{ source: "/(.*)", headers: crossOriginIsolation }];
  },
  webpack: (config, { isServer }) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true, topLevelAwait: true };
    // bb.js and noir reach for optional Node built-ins the browser doesn't need.
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, crypto: false };

    // Never bundle bb.js on the client: its prebuilt browser bundle declares a
    // top-level `__webpack_exports__` that collides with webpack's own module
    // runtime, and its wasm worker cannot live in a hashed chunk. The browser
    // loads it as native ESM from /vendor/bb/ instead — see lib/bb-loader.ts.
    if (!isServer) {
      config.externals = [...(config.externals ?? []), { "@aztec/bb.js": "commonjs @aztec/bb.js" }];
    }
    return config;
  },
};

export default nextConfig;
