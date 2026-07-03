import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/shared.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node22",
  // These are heavy / native-ish; let the consumer resolve them at runtime.
  external: ["@google/genai", "@speech-sdk/core"],
});
