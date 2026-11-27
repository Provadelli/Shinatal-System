/**
 * Shinatal — recalcula e republica `fundo/{ano}` e `estatisticas/publico` com o motor do código
 * (mesmo cálculo das telas, incluindo a soma dos pesos ajustados do rateio).
 *
 * Uso (dentro de backend/scripts, com service-account.json):
 *   node republicar-fundo.mjs --simular   Só leitura: mostra o fundo gravado, o recalculado e a
 *                                         divisão entre os colaboradores (soma das cotas).
 *   node republicar-fundo.mjs --aplicar   Recalcula e grava.
 *
 * As telas de gestão já fazem isso sozinhas (fundo-sincronizador.js); o script serve para corrigir
 * na hora, sem depender de um gestor abrir o sistema.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import admin from "firebase-admin";
import * as motor from "../../frontend/js/calculo-shinatal.js";
import { carregar, carregarMapaDados, republicarAgregados } from "./lib/firestore-util.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const modo = process.argv[2];
if (!["--simular", "--aplicar"].includes(modo)) {
  console.error("Uso: node republicar-fundo.mjs --simular | --aplicar");
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(path.join(DIR, "service-account.json"), "utf8"))) });
const db = admin.firestore();
const hojeISO = motor.hojeISOLocal();
const ano = Number(hojeISO.slice(0, 4));

const dados = await carregar(db);
const mapaDados = await carregarMapaDados(db);
const { fundo } = motor.montarAgregadosFundo(dados.contratos, dados.usuarios, ano, hojeISO, mapaDados);
const dist = motor.calcularDistribuicaoFundo(dados.usuarios, mapaDados, fundo.saldoDisponivel, ano);
const gravado = dados.fundos[String(ano)] || {};
const brl = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

console.log(`Fundo ${ano} gravado:     saldo ${brl(gravado.saldoDisponivel)} · somaPesosAjustados ${gravado.somaPesosAjustados ?? "(ausente)"}`);
console.log(`Fundo ${ano} recalculado: saldo ${brl(fundo.saldoDisponivel)} · somaPesosAjustados ${fundo.somaPesosAjustados}`);
console.log(`Soma das cotas: ${brl(dist.totalDistribuido)} (${dados.usuarios.filter((u) => dist.porUid[u.uid]?.cotaFinal > 0).length} pessoas com cota)`);

if (modo === "--aplicar") {
  const { anos } = await republicarAgregados(db, admin.firestore.FieldValue, "script:republicar-fundo", dados.contratos, dados.usuarios, Object.keys(dados.fundos), hojeISO);
  console.log(`\nGravado: fundo/${anos.join(", fundo/")} e estatisticas/publico.`);
} else {
  console.log("\nSimulação: nada foi gravado. Rode com --aplicar para gravar.");
}
process.exit(0);
