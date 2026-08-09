import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// The suite covers the pure logic the UI leans on — amount parsing, formatting,
// error mapping, proof encoding. Rendering is left out deliberately: it needs a
// browser, a wallet and a live chain, and every UI bug this project has actually
// hit lived in the functions below rather than in the markup.
export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, ".") } },
  test: { environment: "node", include: ["lib/**/*.test.ts"] },
});
