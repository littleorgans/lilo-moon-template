import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Not Vite's default 5173. That port is the first thing every other Vite project on the machine
  // claims, and a dev server that silently moves to 5174 breaks the OAuth redirect URI registered
  // with the identity provider. Pinned so the registered callback and the running server agree.
  server: { port: 5199, strictPort: true },
  preview: { port: 5199, strictPort: true },
  resolve: {
    // `resolve.conditions` replaces the default list. Spread it, then add
    // the workspace-private source condition for serve only.
    conditions:
      command === "serve"
        ? [...defaultClientConditions, "@lilo-moon/source"]
        : [...defaultClientConditions],
  },
  optimizeDeps: {
    exclude: ["@lilo-moon/collections"],
  },
}));
