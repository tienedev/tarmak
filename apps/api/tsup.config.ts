import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts", "src/trpc/router.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  external: ["better-sqlite3"],
});
