import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: path.join(root, "github-pages"),
  base: "/makeroom/",
  publicDir: path.join(root, "public"),
  plugins: [react()],
  resolve: { alias: { "@": root } },
  css: { postcss: root },
  build: { outDir: path.join(root, "pages-dist"), emptyOutDir: true },
});
