import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  plugins: [react()],
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
