import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The eval calls the real model, so it needs gateway credentials. Vitest does not read
// .env.local on its own, and the README tells you to put the key there.
const local = loadEnv("", __dirname, "");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["evals/**/*.eval.ts"],
    // Either credential authenticates the AI Gateway; OIDC is what `vercel env pull` leaves behind.
    env: {
      AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY ?? local.AI_GATEWAY_API_KEY ?? "",
      VERCEL_OIDC_TOKEN: process.env.VERCEL_OIDC_TOKEN ?? local.VERCEL_OIDC_TOKEN ?? "",
    },
  },
});
