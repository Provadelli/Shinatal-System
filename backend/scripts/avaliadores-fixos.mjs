/**
 * Shinatal — grava a tabela de avaliadores fixos da Avaliação de desempenho.
 *
 * A tabela fica no código (lib/avaliadores-fixos.mjs). Este script troca os nomes pelos uids
 * dos cadastros e grava configuracoes/avaliadoresFixos — documento que nenhum navegador pode
 * alterar (firestore.rules: `allow write: if false`) e que as regras usam para conferir o
 * avaliador fixo de cada ciclo.
 *
 * Uso (dentro de backend/scripts, com service-account.json):
 *   node avaliadores-fixos.mjs --simular   Só leitura: mostra como cada nome foi resolvido.
 *   node avaliadores-fixos.mjs --aplicar   Resolve de novo e grava. Aborta se houver erro.
 *
 * Mudar a tabela não mexe em ciclos já criados: o fixo fica copiado no ciclo de cada pessoa.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import admin from "firebase-admin";
import { TABELA_AVALIADORES_FIXOS, resolverTabela } from "./lib/avaliadores-fixos.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const modo = process.argv[2];
if (!["--simular", "--aplicar"].includes(modo)) {
  console.error("Uso: node avaliadores-fixos.mjs --simular | --aplicar");
  process.exit(1);
}

const credencial = JSON.parse(fs.readFileSync(path.join(DIR, "service-account.json"), "utf8"));
admin.initializeApp({ credential: admin.credential.cert(credencial) });
const db = admin.firestore();

const snap = await db.collection("usuarios").get();
const usuarios = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
const { pares, linhas, erros, semCadastro } = resolverTabela(TABELA_AVALIADORES_FIXOS, usuarios);

console.log("Avaliado → avaliador fixo");
for (const l of linhas) console.log(`  ${l.avaliado} → ${l.avaliador}${l.papelAvaliador === "presidente" ? " (Presidente)" : ""}`);
console.log(`${linhas.length} de ${TABELA_AVALIADORES_FIXOS.length} linhas resolvidas.`);

if (semCadastro.length) {
  console.warn("\nSem cadastro ativo (ficam de fora; rode de novo depois que a pessoa tiver conta confirmada):");
  for (const nome of semCadastro) console.warn(`  - ${nome}`);
}

if (erros.length) {
  console.error("\nProblemas (nada foi gravado):");
  for (const e of erros) console.error(`  - ${e}`);
  process.exit(1);
}

if (modo === "--aplicar") {
  await db.doc("configuracoes/avaliadoresFixos").set({
    pares,
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    atualizadoPor: "script:avaliadores-fixos"
  });
  console.log("\nGravado em configuracoes/avaliadoresFixos.");
} else {
  console.log("\nSimulação: nada foi gravado. Rode com --aplicar para gravar.");
}
process.exit(0);
