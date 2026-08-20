import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Do not prebundle workspace packages. Vite's `development` export
  // condition then serves their source, so library edits HMR.
  optimizeDeps: {
    exclude: ["@lilo-moon/collections"],
  },
});
