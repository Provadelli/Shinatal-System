// Shinatal — build da página inicial em React (Vite).
//
// Só a home é React (pasta app/). As outras páginas continuam em HTML estático em frontend/ e
// entram no build sem mudança: frontend/ é o publicDir, copiado inteiro para dist/. Os arquivos
// do React saem em dist/_app/ para não se misturarem com frontend/assets/.
//
// O CSS vem de /css/tailwind.css (gerado por `npm run build:css`, que também lê app/src) e de
// /css/styles.css — os mesmos arquivos das outras páginas, na mesma ordem.
import { defineConfig, type Plugin } from "vite";
import { existsSync } from "node:fs";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.dirname(fileURLToPath(import.meta.url));
const front = path.join(raiz, "frontend");

/**
 * Só no `npm run dev`: imita o cleanUrls da Vercel (/login → login.html) e recarrega o navegador
 * quando um HTML, CSS ou JS de frontend/ muda (o Vite não observa o publicDir sozinho).
 */
function paginasEstaticasAoVivo(): Plugin {
  return {
    name: "shinatal-paginas-estaticas",
    configureServer(server) {
      server.watcher.add(front);
      server.watcher.on("change", (arquivo) => {
        if (arquivo.startsWith(front) && /\.(html|css|js)$/.test(arquivo)) {
          server.ws.send({ type: "full-reload" });
        }
      });
      server.middlewares.use((req, _res, next) => {
        const [caminho, busca = ""] = (req.url || "/").split("?");
        if (caminho !== "/" && !path.extname(caminho) && existsSync(path.join(front, `${caminho}.html`))) {
          req.url = `${caminho}.html${busca ? `?${busca}` : ""}`;
        }
        next();
      });
    }
  };
}

export default defineConfig({
  root: path.join(raiz, "app"),
  publicDir: front,
  plugins: [react(), paginasEstaticasAoVivo()],
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
