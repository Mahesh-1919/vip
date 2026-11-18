import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname), "server-only": path.resolve(__dirname, "tests/stubs/empty.ts") } },
  test: { env: { DATA_MODE: "db" }, fileParallelism: false, setupFiles: ["tests/setup.ts"], include: ["tests/**/*.test.ts"] },
});
