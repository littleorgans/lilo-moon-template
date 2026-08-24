import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defaultClientConditions, defaultServerConditions, defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  plugins: [tanstackStart(), react(), nitro()],
  // Not Vite's default 5173. That port is the first thing every other Vite project on the machine
  // claims, and a dev server that silently moves to 5174 breaks the OAuth redirect URI registered
  // with the identity provider. Pinned so the registered callback and the running server agree.
  //
  // There is deliberately no `preview` block. Preview is no longer `vite preview`: Nitro builds a
  // server and the task runs `node .output/server/index.mjs`, which reads `NITRO_PORT` then `PORT`
  // from the environment and never opens this file. A `preview` key here would read as though it
  // pinned the port and would not. That pin lives in `.moon/tasks/node-application.yml`.
  server: { port: 5199, strictPort: true },
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
  ssr: {
    // Start and Nitro create an SSR environment whose conditions replace the top-level ones rather
    // than extending them, so the workspace source condition has to be set a second time here.
    resolve: {
      conditions:
        command === "serve"
          ? [...defaultServerConditions, "@lilo-moon/source"]
          : [...defaultServerConditions],
    },
  },
}));
