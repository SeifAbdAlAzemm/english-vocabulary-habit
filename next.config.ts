import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Runtime tests use their own output directory and local Auth environment.
  distDir: process.env.VOCABULARY_RUNTIME_TEST === "1" ? ".next-runtime-test" : ".next",
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
