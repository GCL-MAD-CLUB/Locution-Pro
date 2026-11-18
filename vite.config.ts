import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {
  appearanceStorageKey,
  knownAppearances,
  readAppearanceHint,
  seedAppearanceHint,
} from "./src/runtime/appearanceStorage.ts";

const appearanceBoot = `(${seedAppearanceHint.toString()})(${readAppearanceHint.toString()}, ${JSON.stringify(appearanceStorageKey)}, ${JSON.stringify(knownAppearances)});`;

export default defineConfig({
  plugins: [
    react(),
    {
      name: "seed-appearance-before-paint",
      transformIndexHtml: {
        order: "post",
        handler(html, { path }) {
          if (path !== "/index.html") return html;
          return [{ tag: "script", children: appearanceBoot, injectTo: "head-prepend" }];
        },
      },
    },
  ],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
