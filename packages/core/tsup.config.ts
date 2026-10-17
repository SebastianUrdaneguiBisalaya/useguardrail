import { defineConfig } from "tsup";

export default defineConfig({
  bundle: true,

  clean: true,

  dts: {
    resolve: true,
  },
  entry: {
    index: "src/index.ts",
  },

  format: [
    "esm",
    "cjs",
  ],

  minify: false,

  outDir: "dist",

  outExtension({ format }) {
    return {
      js: format === "esm" ? ".mjs" : ".cjs",
    };
  },

  platform: "node",

  skipNodeModulesBundle: true,

  sourcemap: true,

  splitting: false,

  target: "es2022",

  treeshake: true,
});
