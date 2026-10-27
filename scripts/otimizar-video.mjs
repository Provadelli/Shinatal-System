// Shinatal — recomprime o vídeo de fundo do topo da landing page.
//
// O vídeo é só ambientação (sem som, atrás de uma película escura), então dá para reduzir bem a
// resolução e a taxa de bits sem diferença visível: 1280 px de largura, H.264 (toca em qualquer
// navegador), CRF 28, sem áudio, e `+faststart` para começar a tocar antes de baixar inteiro.
//
// Roda com `npm run optimize:video`. Lê o original (background-video.mp4, que fica como fonte) e
// grava background-video-v2.mp4 — nome novo para o cache longo do firebase.json valer sem risco
// de alguém ficar com a versão antiga.
//
// O ffmpeg (~77 MB) NÃO é dependência do projeto, para não pesar em todo `npm ci` (inclusive no
// deploy do GitHub Actions). Instale só quando for usar:  npm i --no-save ffmpeg-static@5.2.0
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let ffmpeg;
try {
  ffmpeg = (await import("ffmpeg-static")).default;
} catch {
  console.error("[optimize-video] ffmpeg não instalado. Rode antes: npm i --no-save ffmpeg-static@5.2.0");
  process.exit(1);
}

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "frontend", "assets");
const entrada = path.join(assets, "background-video.mp4");
const saida = path.join(assets, "background-video-v2.mp4");
if (!existsSync(entrada)) throw new Error(`Não achei ${entrada}`);

execFileSync(ffmpeg, [
  "-y", "-hide_banner", "-loglevel", "error",
  "-i", entrada,
  "-vf", "scale='min(1280,iw)':-2",
  "-c:v", "libx264", "-preset", "slow", "-crf", process.env.CRF || "28",
  "-profile:v", "high", "-pix_fmt", "yuv420p",
  "-an", "-movflags", "+faststart",
  saida
], { stdio: "inherit" });

const mb = (f) => (statSync(f).size / 1024 / 1024).toFixed(1);
console.log(`[optimize-video] ${path.basename(entrada)} ${mb(entrada)} MB -> ${path.basename(saida)} ${mb(saida)} MB`);
