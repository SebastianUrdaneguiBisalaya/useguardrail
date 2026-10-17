import { defineConfig } from "tsup";

export default defineConfig({
  bundle: true,

  clean: true,

  dts: true,

  entry: {
    index: "src/index.ts",
  },

  external: [
    "@useguardril/core",
  ],

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

  platform: "neutral",

  skipNodeModulesBundle: true,

  sourcemap: true,

  splitting: false,

  target: "es2022",

  treeshake: true,

  tsconfig: "tsconfig.build.json",
});
