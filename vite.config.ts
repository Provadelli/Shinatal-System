// Shinatal — build da página inicial em React (Vite).
//
// Só a home é React (pasta app/). As outras páginas continuam em HTML estático em frontend/ e
// entram no build sem mudança: frontend/ é o publicDir, copiado inteiro para dist/. Os arquivos
// do React saem em dist/_app/ para não se misturarem com frontend/assets/.
//
// O CSS vem de /css/tailwind.css (gerado por `npm run build:css`, que também lê app/src) e de
// /css/styles.css — os mesmos arquivos das outras páginas, na mesma ordem.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(raiz, "app"),
  publicDir: path.join(raiz, "frontend"),
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.join(raiz, "app/src"),
      "@legado": path.join(raiz, "frontend/js")
    }
  },
  build: {
    outDir: path.join(raiz, "dist"),
    emptyOutDir: true,
    assetsDir: "_app"
  },
  server: {
    fs: { allow: [raiz] }
  }
});
