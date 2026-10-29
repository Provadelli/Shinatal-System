// Shinatal — gera as versões leves do vídeo de fundo do topo da landing page.
//
// O vídeo é só ambientação (sem som, atrás de uma película escura), então dá para reduzir bem a
// resolução e a taxa de bits sem diferença visível. Saem duas versões, escolhidas pelo
// js/pagina-index.js conforme a orientação da tela:
//   - hero-paisagem-v3.mp4 — computador e tablet deitado: 1280 px de largura.
//   - hero-retrato-v3.mp4  — celular em pé: recorte central 9:16, 540x960. Num celular em pé o
//     vídeo horizontal seria cortado nas laterais de qualquer jeito (object-fit: cover), então
//     mandar só o miolo economiza mais da metade dos bytes sem perder nada do que aparece.
// Ambas em H.264 (toca em qualquer navegador e celular), na taxa de quadros do original, sem áudio,
// com `+faststart` para começar a tocar antes de baixar inteiro.
//
// Roda com `npm run optimize:video`. Lê o original (design/video/hero-original.mp4, que fica fora
// da pasta publicada: é só a fonte, não vai para o site). O "v3" no nome garante que o cache longo
// (vercel.json) nunca sirva a versão antiga — se recomprimir de novo, troque para v4 aqui, em
// index.html e em styles.css (pôsteres), senão quem já visitou continua vendo a versão velha.
//
// O ffmpeg (~77 MB) NÃO é dependência do projeto, para não pesar em todo `npm install`.
// Instale só quando for usar:  npm i --no-save ffmpeg-static@5.2.0
import { execFileSync } from "node:child_process";
import { existsSync, statSync, rmSync } from "node:fs";
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

let ffmpeg;
try {
  ffmpeg = (await import("ffmpeg-static")).default;
} catch {
  console.error("[optimize-video] ffmpeg não instalado. Rode antes: npm i --no-save ffmpeg-static@5.2.0");
  process.exit(1);
}

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(raiz, "frontend", "assets");
const entrada = path.join(raiz, "design", "video", "hero-original.mp4");
if (!existsSync(entrada)) throw new Error(`Não achei ${entrada}`);

const CRF = process.env.CRF || "30";
const versoes = [
  { saida: "hero-paisagem-v3.mp4", filtro: "scale='min(1280,iw)':-2" },
  { saida: "hero-retrato-v3.mp4", filtro: "crop='min(iw,ih*9/16)':ih,scale=540:-2" }
];

const mb = (f) => (statSync(f).size / 1024 / 1024).toFixed(2);
for (const { saida, filtro } of versoes) {
  const destino = path.join(assets, saida);
  execFileSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", entrada,
    "-vf", filtro,
    "-c:v", "libx264", "-preset", "veryslow", "-crf", CRF,
    "-profile:v", "high", "-level", "4.0", "-pix_fmt", "yuv420p",
    "-an", "-movflags", "+faststart",
    destino
  ], { stdio: "inherit" });
  console.log(`[optimize-video] ${saida}: ${mb(destino)} MB`);

  // Pôster = 1º quadro desta versão, em WebP. É o fundo da seção enquanto o vídeo não toca
  // (e para sempre, com "reduzir movimento"), e o LCP da home — por isso leve e do tamanho certo.
  const quadro = destino.replace(/\.mp4$/, ".png");
  execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-i", destino, "-frames:v", "1", quadro], { stdio: "inherit" });
  const poster = destino.replace(/\.mp4$/, ".webp").replace("hero-", "hero-poster-");
  await sharp(quadro).webp({ quality: 62, effort: 6 }).toFile(poster);
  rmSync(quadro);
  console.log(`[optimize-video] ${path.basename(poster)}: ${(statSync(poster).size / 1024).toFixed(0)} KB`);
}
console.log(`[optimize-video] original ${path.basename(entrada)}: ${mb(entrada)} MB (só fonte, não vai para o site)`);
