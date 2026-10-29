// Shinatal — aplica as partes de layout compartilhadas (hoje: o rodapé) em todas as páginas.
//
// Dois rodapés, como em sistemas profissionais: o COMPLETO (chamada, navegação, contato) só nas
// páginas públicas de conteúdo; o COMPACTO (uma linha: ©, links institucionais, versão) no login,
// no cadastro e nas páginas internas — lá a pessoa está trabalhando, e um rodapé grande só distrai.
//
// O site não tem etapa de build (HTML estático servido pela Vercel), então o rodapé não pode ser
// "incluído" em tempo de execução sem custo: montá-lo por JS atrasaria a página e o esconderia de
// quem está sem JS. Em vez disso, a fonte única fica em scripts/partials/rodape.html e este script
// grava o mesmo bloco em cada frontend/*.html, entre os marcadores <!-- rodape:inicio --> e
// <!-- rodape:fim --> (na primeira vez, troca o <footer> antigo da página).
//
// Rode com `npm run layout` sempre que editar um partial ou mudar a versão (VERSAO abaixo).
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSAO = "v2.0";
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FRONT = path.join(RAIZ, "frontend");
const hoje = new Date();
const valores = {
  ANO: String(hoje.getFullYear()),
  VERSAO,
  ATUALIZADO: hoje.toLocaleDateString("pt-BR")
};

const partial = (nome) =>
  readFileSync(path.join(RAIZ, "scripts", "partials", `${nome}.html`), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\{\{(\w+)\}\}/g, (_, chave) => valores[chave] ?? "")
    .trimEnd();

const PAGINAS_RODAPE_COMPLETO = new Set(["index.html", "termos.html", "privacidade.html"]);
const rodapes = { completo: partial("rodape"), compacto: partial("rodape-compacto") };
const BLOCO = /<!-- rodape:inicio -->[\s\S]*?<!-- rodape:fim -->/;
const FOOTER_ANTIGO = /<footer\b[\s\S]*?<\/footer>/;

let alteradas = 0;
for (const arquivo of readdirSync(FRONT).filter((f) => f.endsWith(".html"))) {
  const caminho = path.join(FRONT, arquivo);
  const original = readFileSync(caminho, "utf8");
  const crlf = original.includes("\r\n");
  const texto = original.replace(/\r\n/g, "\n");
  const rodape = rodapes[PAGINAS_RODAPE_COMPLETO.has(arquivo) ? "completo" : "compacto"];
  const novoBloco = `<!-- rodape:inicio -->\n${rodape}\n<!-- rodape:fim -->`;
  let novo;
  if (BLOCO.test(texto)) novo = texto.replace(BLOCO, () => novoBloco);
  else if (FOOTER_ANTIGO.test(texto)) novo = texto.replace(FOOTER_ANTIGO, () => novoBloco);
  else { console.warn(`[layout] ${arquivo}: sem <footer> nem marcadores — ignorado.`); continue; }
  const saida = crlf ? novo.replace(/\n/g, "\r\n") : novo;
  if (saida !== original) { writeFileSync(caminho, saida); alteradas++; }
}
console.log(`[layout] rodapés ${VERSAO}: completo em ${[...PAGINAS_RODAPE_COMPLETO].join(", ")}, compacto nas demais (${alteradas} página(s) alterada(s)).`);
