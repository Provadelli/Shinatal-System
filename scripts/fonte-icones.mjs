// Shinatal — fontes hospedadas no próprio site (Inter, Playfair Display e Material Symbols).
//
// Antes as páginas pediam as fontes ao Google Fonts: duas folhas de estilo de outro domínio que
// travavam a primeira pintura (~1 s no celular). Agora este script baixa os .woff2 uma vez para
// frontend/assets/fonts/ e gera frontend/css/fontes.css com os @font-face locais.
//
// - Texto: só o subconjunto "latin" (cobre português inteiro, com acentos e ç).
// - Ícones: Material Symbols com um estilo fixo (contorno, peso 400) e SÓ os ícones usados no site.
// - Nome do arquivo leva um hash do conteúdo, então o cache longo da Vercel nunca serve versão velha.
//
// Roda com `npm run icones`. Sempre que um ícone novo entrar no HTML ou no JS, rode de novo.
// A auditoria (backend/tests/a11y) também confere que todo ícone visível foi desenhado.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "frontend");
const PASTA_FONTES = path.join(FRONT, "assets", "fonts");
const html = readdirSync(FRONT).filter((f) => f.endsWith(".html"));
const js = readdirSync(path.join(FRONT, "js")).filter((f) => f.endsWith(".js")).map((f) => path.join("js", f));
const ler = (f) => readFileSync(path.join(FRONT, f), "utf8");

/* ---------- 1. Quais ícones o site usa ---------- */
const NOME = /^[a-z][a-z0-9_]{1,40}$/;
const icones = new Set();
const adicionar = (n) => { if (NOME.test(n)) icones.add(n); };

// Ligatures escritas direto no HTML (e em templates do JS): <span class="material-symbols-outlined …">nome</span>
for (const f of [...html, ...js]) {
  for (const m of ler(f).matchAll(/material-symbols-outlined[^>]*>\s*([a-z0-9_]+)\s*</g)) adicionar(m[1]);
}
// Nomes trocados por JS: `icone: "nome"`, `icones = { x: "nome" }` e `icone.textContent = … "nome"`.
for (const f of js) {
  const fonte = ler(f);
  for (const m of fonte.matchAll(/\bicone\w*\s*:\s*"([a-z0-9_]+)"/g)) adicionar(m[1]);
  for (const m of fonte.matchAll(/\bicones\s*=\s*\{([^}]*)\}/g)) for (const v of m[1].matchAll(/"([a-z0-9_]+)"/g)) adicionar(v[1]);
  for (const linha of fonte.split("\n").filter((l) => /\bicone\w*\.textContent\s*=/.test(l))) {
    for (const v of linha.matchAll(/"([a-z0-9_]+)"/g)) adicionar(v[1]);
  }
}
const lista = [...icones].sort(); // o Google Fonts exige ordem alfabética

/* ---------- 2. Baixa as fontes do Google Fonts ---------- */
// User-Agent de navegador atual: sem ele o Google devolve TTF em vez de woff2.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const URL_TEXTO = "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;0,800;1,700;1,800&family=Inter:wght@400;500;600;700&display=swap";
const URL_ICONES = `https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&icon_names=${lista.join(",")}&display=block`;

async function baixarTexto(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${r.status} ao baixar ${url}`);
  return r.text();
}

/** Lê os blocos @font-face do CSS do Google, com o comentário de subconjunto que vem antes. */
function blocos(css) {
  return [...css.matchAll(/(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g)].map(([, subconjunto, corpo]) => ({
    subconjunto: subconjunto || "",
    familia: corpo.match(/font-family:\s*'([^']+)'/)[1],
    estilo: corpo.match(/font-style:\s*(\w+)/)[1],
    peso: corpo.match(/font-weight:\s*([\d ]+)/)[1].trim(),
    url: corpo.match(/url\((https:[^)]+)\)/)[1],
    unicode: corpo.match(/unicode-range:\s*([^;]+);/)?.[1].trim() || null,
    display: corpo.match(/font-display:\s*(\w+)/)?.[1] || "swap"
  }));
}

const faces = [
  ...blocos(await baixarTexto(URL_TEXTO)).filter((b) => b.subconjunto === "latin"),
  ...blocos(await baixarTexto(URL_ICONES))
];

rmSync(PASTA_FONTES, { recursive: true, force: true });
mkdirSync(PASTA_FONTES, { recursive: true });

const porUrl = new Map(); // a mesma fonte variável serve vários pesos: baixa uma vez só
const arquivos = [];
for (const f of faces) {
  if (!porUrl.has(f.url)) {
    const dados = Buffer.from(await (await fetch(f.url, { headers: { "User-Agent": UA } })).arrayBuffer());
    const hash = createHash("sha256").update(dados).digest("hex").slice(0, 10);
    const base = f.familia.toLowerCase().replace(/[^a-z]+/g, "-").replace(/-$/, "");
    const nome = `${base}${f.estilo === "italic" ? "-italic" : ""}-${hash}.woff2`;
    writeFileSync(path.join(PASTA_FONTES, nome), dados);
    porUrl.set(f.url, nome);
    arquivos.push({ nome, kb: (dados.length / 1024).toFixed(1) });
  }
  f.arquivo = porUrl.get(f.url);
}

/* ---------- 3. Gera css/fontes.css ---------- */
// Agrupa pesos que apontam para o mesmo arquivo (fonte variável) num único @font-face com faixa.
const grupos = new Map();
for (const f of faces) {
  const chave = `${f.familia}|${f.estilo}|${f.arquivo}`;
  const g = grupos.get(chave) || { ...f, pesos: [] };
  g.pesos.push(...f.peso.split(" ").map(Number));
  grupos.set(chave, g);
}
let css = "/* Gerado por scripts/fonte-icones.mjs (npm run icones) — não edite à mão. */\n";
for (const g of grupos.values()) {
  const min = Math.min(...g.pesos), max = Math.max(...g.pesos);
  css += `@font-face{font-family:'${g.familia}';font-style:${g.estilo};font-weight:${min === max ? min : `${min} ${max}`};` +
    `font-display:${g.display};src:url(../assets/fonts/${g.arquivo}) format('woff2');` +
    (g.unicode ? `unicode-range:${g.unicode};` : "") + "}\n";
}
// Mesma classe que o CSS do Google trazia para os ícones.
css += ".material-symbols-outlined{font-family:'Material Symbols Outlined';font-weight:normal;font-style:normal;font-size:24px;" +
  "line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;word-wrap:normal;direction:ltr;" +
  "-webkit-font-feature-settings:'liga';font-feature-settings:'liga';-webkit-font-smoothing:antialiased;}\n";
writeFileSync(path.join(FRONT, "css", "fontes.css"), css);

/* ---------- 4. Troca os links do Google Fonts nas páginas ---------- */
// Pré-carrega só a fonte de ícones (9 KB, font-display: block — sem ela os ícones ficam invisíveis).
// As de texto usam swap: o texto aparece na hora com a fonte do sistema, e pré-carregá-las
// disputaria banda com o CSS, que é o que libera a primeira pintura no celular.
const arquivoDe = (familia, estilo = "normal") => [...grupos.values()].find((g) => g.familia === familia && g.estilo === estilo)?.arquivo;
const preloads = [arquivoDe("Material Symbols Outlined")].filter(Boolean);

const BLOCO = /<!-- fontes:inicio -->[\s\S]*?<!-- fontes:fim -->/;
const LINKS_GOOGLE = /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com" \/>\s*<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin \/>\s*<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*"[^>]*\/>(\s*<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*"[^>]*\/>)?/;
let alterados = 0;
for (const f of html) {
  const original = ler(f);
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const novoBloco = ["<!-- fontes:inicio -->",
    ...preloads.map((a) => `<link rel="preload" as="font" type="font/woff2" href="assets/fonts/${a}" crossorigin />`),
    `<link rel="stylesheet" href="css/fontes.css" />`,
    "<!-- fontes:fim -->"].join(eol);
  let novo = original;
  if (BLOCO.test(novo)) novo = novo.replace(BLOCO, novoBloco);
  else if (LINKS_GOOGLE.test(novo)) novo = novo.replace(LINKS_GOOGLE, novoBloco);
  else continue;
  if (novo !== original) { writeFileSync(path.join(FRONT, f), novo); alterados++; }
}

console.log(`${lista.length} ícones: ${lista.join(", ")}`);
console.log(`Fontes: ${arquivos.map((a) => `${a.nome} (${a.kb} KB)`).join(", ")}`);
console.log(`${alterados} página(s) atualizada(s).`);
if (!existsSync(path.join(FRONT, "css", "fontes.css"))) process.exit(1);
