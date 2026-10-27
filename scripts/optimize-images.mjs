// Shinatal — converte os assets pesados de frontend/assets/ para WebP (com tamanhos
// responsivos onde faz sentido). Roda com `npm run optimize:images`. Idempotente: usa
// withoutEnlargement, então rodar de novo sobre uma imagem já pequena nunca amplia.
import sharp from "sharp";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raizAssets = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "frontend", "assets");

// Logos/decorativos: um único arquivo, preservando alpha (PNG com transparência).
const arquivosUnicos = [
  { entrada: "logoshinatal-cropped.png", saida: "logoshinatal-cropped.webp", largura: 320, qualidade: 90 },
  { entrada: "chapeu-natal.png", saida: "chapeu-natal.webp", largura: 240, qualidade: 85 }
];

// Fotos da landing: geram um arquivo por largura, para uso com srcset.
const fotosResponsivas = [
  { entrada: "foto1.jfif", base: "foto1", larguras: [400, 800, 1200], qualidade: 80 },
  { entrada: "foto2.jfif", base: "foto2", larguras: [320, 640, 960], qualidade: 78 },
  { entrada: "foto3.jfif", base: "foto3", larguras: [320, 640, 960], qualidade: 78 },
  { entrada: "foto4.jfif", base: "foto4", larguras: [320, 640, 960], qualidade: 78 },
  { entrada: "foto5.jfif", base: "foto5", larguras: [320, 640, 960], qualidade: 78 }
];

async function converterUnico({ entrada, saida, largura, qualidade }) {
  const caminhoEntrada = path.join(raizAssets, entrada);
  if (!existsSync(caminhoEntrada)) {
    console.warn(`[optimize-images] pulei ${entrada} (não encontrado)`);
    return;
  }
  const caminhoSaida = path.join(raizAssets, saida);
  await sharp(caminhoEntrada)
    .resize({ width: largura, withoutEnlargement: true })
    .webp({ quality: qualidade })
    .toFile(caminhoSaida);
  console.log(`[optimize-images] ${entrada} -> ${saida} (w=${largura}, q=${qualidade})`);
}

async function converterResponsiva({ entrada, base, larguras, qualidade }) {
  const caminhoEntrada = path.join(raizAssets, entrada);
  if (!existsSync(caminhoEntrada)) {
    console.warn(`[optimize-images] pulei ${entrada} (não encontrado)`);
    return;
  }
  for (const largura of larguras) {
    const caminhoSaida = path.join(raizAssets, `${base}-${largura}.webp`);
    await sharp(caminhoEntrada)
      .resize({ width: largura, withoutEnlargement: true })
      .webp({ quality: qualidade })
      .toFile(caminhoSaida);
    console.log(`[optimize-images] ${entrada} -> ${base}-${largura}.webp (q=${qualidade})`);
  }
}

// Favicons pequenos gerados a partir do original de 512 px (47 KB), que continua como fonte:
// o navegador só precisa de 32 px na aba e 180 px no atalho da tela inicial do iPhone.
const favicons = [
  { saida: "favicon-32.png", largura: 32 },
  { saida: "apple-touch-icon.png", largura: 180 }
];
async function gerarFavicons() {
  const origem = path.join(raizAssets, "favicon-shinatal.png");
  if (!existsSync(origem)) return console.warn("[optimize-images] pulei os favicons (favicon-shinatal.png não encontrado)");
  for (const { saida, largura } of favicons) {
    await sharp(origem).resize({ width: largura }).png({ compressionLevel: 9, palette: true }).toFile(path.join(raizAssets, saida));
    console.log(`[optimize-images] favicon-shinatal.png -> ${saida} (${largura} px)`);
  }
}

for (const item of arquivosUnicos) await converterUnico(item);
for (const item of fotosResponsivas) await converterResponsiva(item);
await gerarFavicons();

console.log("[optimize-images] concluído.");
