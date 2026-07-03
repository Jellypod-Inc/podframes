import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Compile the workspace core package (TS source) for the server.
  transpilePackages: ["@podframes/core"],
  // Keep heavy, node-only deps external so Next doesn't bundle them.
  serverExternalPackages: ["hyperframes", "@google/genai", "@speech-sdk/core", "sharp", "dotenv"],
  // @podframes/core is TS source using `.js` import specifiers (NodeNext style).
  // Map `.js` → `.ts` so the bundler resolves them when transpiling the package.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
  turbopack: {
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"],
  },
};

export default nextConfig;
