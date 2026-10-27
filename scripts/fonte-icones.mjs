// Shinatal — gera o link da fonte Material Symbols só com os ícones usados no site.
//
// A fonte completa, com todos os eixos variáveis, pesa vários MB. O site usa um estilo único
// (contorno, peso 400, sem preenchimento) e algumas dezenas de ícones, então pedimos ao Google
// Fonts só isso: eixos fixos + `icon_names=` com a lista abaixo.
//
// Roda com `npm run icones`. Sempre que um ícone novo entrar no HTML ou no JS, rode de novo.
// A auditoria (backend/tests/a11y) também confere que todo ícone visível foi desenhado.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "frontend");
const html = readdirSync(FRONT).filter((f) => f.endsWith(".html"));
const js = readdirSync(path.join(FRONT, "js")).filter((f) => f.endsWith(".js")).map((f) => path.join("js", f));
const ler = (f) => readFileSync(path.join(FRONT, f), "utf8");

const NOME = /^[a-z][a-z0-9_]{1,40}$/;
const icones = new Set();
const adicionar = (n) => { if (NOME.test(n)) icones.add(n); };

// 1) Ligatures escritas direto no HTML (e em templates do JS): <span class="material-symbols-outlined …">nome</span>
for (const f of [...html, ...js]) {
  for (const m of ler(f).matchAll(/material-symbols-outlined[^>]*>\s*([a-z0-9_]+)\s*</g)) adicionar(m[1]);
}
// 2) Nomes trocados por JS: `icone: "nome"`, `icones = { x: "nome" }` e `icone.textContent = … "nome"`.
for (const f of js) {
  const fonte = ler(f);
  for (const m of fonte.matchAll(/\bicone\w*\s*:\s*"([a-z0-9_]+)"/g)) adicionar(m[1]);
  for (const m of fonte.matchAll(/\bicones\s*=\s*\{([^}]*)\}/g)) for (const v of m[1].matchAll(/"([a-z0-9_]+)"/g)) adicionar(v[1]);
  for (const linha of fonte.split("\n").filter((l) => /\bicone\w*\.textContent\s*=/.test(l))) {
    for (const v of linha.matchAll(/"([a-z0-9_]+)"/g)) adicionar(v[1]);
  }
}

const lista = [...icones].sort(); // o Google Fonts exige ordem alfabética
const urlIcones = `https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&icon_names=${lista.join(",")}&display=block`;
const urlTexto = "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;0,800;1,700;1,800&family=Inter:wght@400;500;600;700&display=swap";

// Troca o <link> antigo (ícones + texto juntos, ou já separados) pelos dois novos.
const LINK_FONTES = /<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*"[^>]*\/>(\r?\n\s*<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*"[^>]*\/>)?/;
const PRECONNECT = /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com" \/>(\r?\n\s*<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin \/>)?/;
let alterados = 0;
for (const f of html) {
  const original = ler(f);
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  if (!LINK_FONTES.test(original)) continue;
  const novo = original
    .replace(PRECONNECT, `<link rel="preconnect" href="https://fonts.googleapis.com" />${eol}<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />`)
    .replace(LINK_FONTES, `<link href="${urlTexto}" rel="stylesheet" />${eol}<link href="${urlIcones}" rel="stylesheet" />`);
  if (novo !== original) { writeFileSync(path.join(FRONT, f), novo); alterados++; }
}
console.log(`${lista.length} ícones: ${lista.join(", ")}`);
console.log(`${alterados} página(s) atualizada(s).`);
