/**
 * Shinatal — Recálculo global dos contratos pela régua de meses v2 (auditável e idempotente).
 *
 * O valor de cada contrato NÃO fica gravado no banco: o portal recalcula tudo a partir das
 * datas e quantidades com frontend/js/calculo-shinatal.js. Então, assim que a régua v2 entra no
 * ar, todos os contratos (antigos e novos) já passam a ser calculados por ela. Este script:
 *   1. compara, contrato a contrato e exercício a exercício, a régua antiga
 *      (legado/calculo-shinatal-v1.mjs) com a nova;
 *   2. ACRESCENTA ao histórico de cada contrato alterado uma entrada `recalculo_regra`
 *      (valor anterior, valor recalculado, diferença, por exercício, data, motivo) — nunca
 *      edita nem apaga entradas existentes;
 *   3. republica os agregados `fundo/{ano}` e `estatisticas/publico`.
 *
 * Uso (dentro de backend/scripts, com service-account.json):
 *   node recalcular-regra-v2.mjs --simular
 *       Só leitura. Grava backup + relatório em out/recalculo-v2-<data-hora>/.
 *   node recalcular-regra-v2.mjs --aplicar out/recalculo-v2-<data-hora>
 *       Aplica o plano daquela simulação. Aborta se algum contrato mudou depois da simulação
 *       ou se houver solicitação pendente de contrato empresarial. Pode ser repetido: contratos
 *       já migrados são pulados (idempotente).
 *   node recalcular-regra-v2.mjs --reverter out/recalculo-v2-<data-hora>
 *       Depois de reverter o commit do motor: acrescenta `reversao_regra` aos contratos
 *       migrados e republica os agregados com o motor que estiver no código.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import admin from "firebase-admin";
import * as antigo from "./legado/calculo-shinatal-v1.mjs";
import * as novo from "../../frontend/js/calculo-shinatal.js";
import { planejarMigracao, montarEntradaAuditoria, montarEntradaReversao, jaMigrado, relatorioCSV, AUTOR_SCRIPT, TOLERANCIA } from "./lib/recalculo.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const VERSAO = novo.VERSAO_REGRA_CALCULO;
const TIPOS_SOLICITACAO_CONTRATO = ["contrato_empresarial_criar", "contrato_empresarial_editar", "contrato_empresarial_excluir"];

const credencial = JSON.parse(fs.readFileSync(path.join(DIR, "service-account.json"), "utf8"));
admin.initializeApp({ credential: admin.credential.cert(credencial) });
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

/* ----------------------------- utilitários ----------------------------- */

/** Firestore → JSON (Timestamps viram {_timestamp: ISO}). */
function serializar(valor) {
  if (valor instanceof Timestamp) return { _timestamp: valor.toDate().toISOString() };
  if (Array.isArray(valor)) return valor.map(serializar);
  if (valor && typeof valor === "object") return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, serializar(v)]));
  return valor;
}

/** Hash do que importa para o cálculo — detecta contrato alterado entre a simulação e a aplicação. */
function hashContrato(c) {
  const { historicoMovimentacoes, ...resto } = serializar(c);
  const prazo = (historicoMovimentacoes || []).filter((h) => h.tipo === "edicao_prazo");
  return crypto.createHash("sha256").update(JSON.stringify(ordenar({ ...resto, prazo }))).digest("hex");
}
function ordenar(v) {
  if (Array.isArray(v)) return v.map(ordenar);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar(v[k])]));
  return v;
}

async function carregar() {
  const [contratosSnap, usuariosSnap, fundoSnap, publicoSnap, solicitacoesSnap] = await Promise.all([
    db.collection("contratosEmpresariais").get(),
    db.collection("usuarios").get(),
    db.collection("fundo").get(),
    db.collection("estatisticas").doc("publico").get(),
    db.collection("solicitacoes").where("status", "==", "pendente").get()
  ]);
  return {
    contratos: contratosSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    usuarios: usuariosSnap.docs.map((d) => ({ uid: d.id, ...d.data() })),
    fundos: Object.fromEntries(fundoSnap.docs.map((d) => [d.id, d.data()])),
    publico: publicoSnap.exists ? publicoSnap.data() : null,
    pendentesContrato: solicitacoesSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => TIPOS_SOLICITACAO_CONTRATO.includes(s.tipo))
  };
}

/** Republica `fundo/{ano}` (todos os anos com movimento ou já publicados) e `estatisticas/publico`. */
async function republicarAgregados(contratos, usuarios, anosExistentes, hojeISO) {
  const anoAtual = Number(hojeISO.slice(0, 4));
  const anos = [...new Set([...novo.anosComMovimento(contratos, hojeISO), ...anosExistentes.map(Number), anoAtual])]
    .filter(Number.isFinite).sort((a, b) => a - b);
  const publicados = {};
  for (const ano of anos) {
    const { fundo } = novo.montarAgregadosFundo(contratos, usuarios, ano, hojeISO);
    await db.collection("fundo").doc(String(ano)).set({
      ...fundo, atualizadoEm: FieldValue.serverTimestamp(), atualizadoPor: AUTOR_SCRIPT
    });
    publicados[ano] = fundo;
  }
  const { publico } = novo.montarAgregadosFundo(contratos, usuarios, anoAtual, hojeISO);
  await db.collection("estatisticas").doc("publico").set({ ...publico, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
  return { anos, publicados, publico };
}

/** Relê o banco e confere que cada `fundo/{ano}` bate com o recálculo. */
async function validar(hojeISO) {
  const { contratos, usuarios, fundos } = await carregar();
  const divergencias = [];
  for (const [ano, gravado] of Object.entries(fundos)) {
    const { fundo } = novo.montarAgregadosFundo(contratos, usuarios, Number(ano), hojeISO);
    for (const k of ["arrecadado", "estornos", "saldoDisponivel"]) {
      if (Math.abs((gravado[k] || 0) - fundo[k]) >= TOLERANCIA) divergencias.push({ ano, campo: k, gravado: gravado[k], esperado: fundo[k] });
    }
  }
  return divergencias;
}

/* ------------------------------- modos ------------------------------- */

async function simular() {
  const hojeISO = novo.hojeISOLocal();
  const dados = await carregar();
  const plano = planejarMigracao(dados.contratos, antigo, novo, VERSAO, hojeISO);
  const pasta = path.join(DIR, "out", `recalculo-v2-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.mkdirSync(pasta, { recursive: true });

  fs.writeFileSync(path.join(pasta, "backup.json"), JSON.stringify(serializar({
    geradoEm: new Date().toISOString(), versaoRegra: VERSAO, hojeISO,
    contratosEmpresariais: dados.contratos, fundo: dados.fundos, estatisticasPublico: dados.publico
  }), null, 2));
  const anosFundo = {};
  for (const ano of plano.anos) {
    anosFundo[ano] = {
      gravado: dados.fundos[String(ano)] ? serializar(dados.fundos[String(ano)]) : null,
      reguaAntiga: antigo.calcularFundo(dados.contratos, ano, hojeISO),
      reguaNova: novo.calcularFundo(dados.contratos, ano, hojeISO)
    };
  }
  fs.writeFileSync(path.join(pasta, "plano.json"), JSON.stringify({
    versaoRegra: VERSAO, hojeISO,
    analisados: plano.analisados,
    aAtualizar: plano.aAtualizar.map((c) => c.id),
    jaMigrados: plano.jaMigrados,
    hashes: Object.fromEntries(dados.contratos.map((c) => [c.id, hashContrato(c)])),
    pendentesContrato: dados.pendentesContrato.map((s) => ({ id: s.id, tipo: s.tipo, descricao: s.descricao })),
    fundoPorAno: anosFundo,
    comparacoes: plano.comparacoes
  }, null, 2));
  fs.writeFileSync(path.join(pasta, "relatorio.csv"), "﻿" + relatorioCSV(plano.comparacoes));

  console.log(`Régua ${VERSAO} — simulação (nenhuma gravação feita)`);
  console.log(`Contratos analisados: ${plano.analisados}`);
  console.log(`Contratos com diferença a registrar: ${plano.aAtualizar.length}`);
  console.log(`Contratos já migrados: ${plano.jaMigrados.length}`);
  for (const [ano, f] of Object.entries(anosFundo)) {
    console.log(`Fundo ${ano}: régua antiga ${f.reguaAntiga.saldoDisponivel.toFixed(2)} → nova ${f.reguaNova.saldoDisponivel.toFixed(2)} (gravado: ${f.gravado ? Number(f.gravado.saldoDisponivel).toFixed(2) : "—"})`);
  }
  for (const c of plano.aAtualizar) {
    console.log(`  • ${c.nomeEmpresa} (${c.id}): ${c.antes.toFixed(2)} → ${c.depois.toFixed(2)} (${c.diferenca >= 0 ? "+" : ""}${c.diferenca.toFixed(2)})`);
  }
  if (dados.pendentesContrato.length) {
    console.log(`\n⚠ ${dados.pendentesContrato.length} solicitação(ões) pendente(s) de contrato empresarial — resolva antes de --aplicar.`);
  }
  console.log(`\nArquivos: ${pasta}`);
}

function lerPlano(pasta) {
  const arquivo = path.join(pasta, "plano.json");
  if (!fs.existsSync(arquivo) || !fs.existsSync(path.join(pasta, "backup.json"))) {
    throw new Error(`Simulação não encontrada em ${pasta} (rode --simular primeiro).`);
  }
  const plano = JSON.parse(fs.readFileSync(arquivo, "utf8"));
  if (plano.versaoRegra !== VERSAO) throw new Error(`O plano é da régua ${plano.versaoRegra}, mas o motor atual é ${VERSAO}.`);
  return plano;
}

async function aplicar(pasta) {
  const planoSalvo = lerPlano(pasta);
  const hojeISO = novo.hojeISOLocal();
  const dados = await carregar();

  if (dados.pendentesContrato.length) {
    throw new Error(`Há ${dados.pendentesContrato.length} solicitação(ões) pendente(s) de contrato empresarial. `
      + "Aprovar uma delas depois da migração sobrescreveria o histórico (o pedido guarda uma cópia antiga). Resolva-as e simule de novo.");
  }
  const alterados = dados.contratos.filter((c) => planoSalvo.hashes[c.id] && planoSalvo.hashes[c.id] !== hashContrato(c)).map((c) => c.id);
  const novos = dados.contratos.filter((c) => !planoSalvo.hashes[c.id]).map((c) => c.id);
  if (alterados.length || novos.length) {
    throw new Error(`Contratos mudaram desde a simulação (alterados: ${alterados.join(", ") || "—"}; novos: ${novos.join(", ") || "—"}). Simule de novo.`);
  }

  const plano = planejarMigracao(dados.contratos, antigo, novo, VERSAO, hojeISO);
  const registros = [];
  for (const comparacao of plano.aAtualizar) {
    const ref = db.collection("contratosEmpresariais").doc(comparacao.id);
    const resultado = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return "inexistente";
      const atual = { id: snap.id, ...snap.data() };
      if (jaMigrado(atual, VERSAO)) return "ja_migrado"; // corrida com outra execução
      const entrada = montarEntradaAuditoria(comparacao, VERSAO, Timestamp.now());
      tx.update(ref, { historicoMovimentacoes: FieldValue.arrayUnion(entrada) });
      return "registrado";
    });
    registros.push({ id: comparacao.id, nomeEmpresa: comparacao.nomeEmpresa, resultado, antes: comparacao.antes, depois: comparacao.depois, diferenca: comparacao.diferenca, porAno: comparacao.porAno });
    console.log(`  ${resultado === "registrado" ? "✔" : "·"} ${comparacao.nomeEmpresa} (${comparacao.id}): ${resultado}`);
  }

  const atualizados = (await carregar()).contratos;
  const agregados = await republicarAgregados(atualizados, dados.usuarios, Object.keys(dados.fundos), hojeISO);
  const divergencias = await validar(hojeISO);

  const resumo = {
    versaoRegra: VERSAO, aplicadoEm: new Date().toISOString(), hojeISO,
    contratosAnalisados: plano.analisados,
    contratosAtualizados: registros.filter((r) => r.resultado === "registrado").length,
    contratosJaMigrados: plano.jaMigrados.length,
    registros, agregados, divergencias
  };
  fs.writeFileSync(path.join(pasta, `aplicacao-${Date.now()}.json`), JSON.stringify(resumo, null, 2));
  console.log(`\nAnalisados: ${resumo.contratosAnalisados} | atualizados agora: ${resumo.contratosAtualizados} | já migrados antes: ${resumo.contratosJaMigrados}`);
  console.log(`Fundos republicados: ${agregados.anos.join(", ")} | divergências após validar: ${divergencias.length}`);
  if (divergencias.length) {
    console.error(divergencias);
    process.exitCode = 2;
  }
}

async function reverter(pasta) {
  lerPlano(pasta);
  const hojeISO = novo.hojeISOLocal();
  const dados = await carregar();
  let revertidos = 0;
  for (const c of dados.contratos.filter((x) => jaMigrado(x, VERSAO))) {
    const valorAtual = novo.calcularResumoContratoEmpresarial(c, hojeISO).totalCreditadoFundo;
    const entrada = montarEntradaReversao(c, VERSAO, Timestamp.now(), Math.round(valorAtual * 100) / 100);
    await db.collection("contratosEmpresariais").doc(c.id).update({ historicoMovimentacoes: FieldValue.arrayUnion(entrada) });
    revertidos++;
  }
  const atualizados = (await carregar()).contratos;
  const agregados = await republicarAgregados(atualizados, dados.usuarios, Object.keys(dados.fundos), hojeISO);
  console.log(`Reversão registrada em ${revertidos} contrato(s). Fundos republicados: ${agregados.anos.join(", ")}.`);
}

/* ------------------------------- entrada ------------------------------- */

const [modo = "--simular", pasta] = process.argv.slice(2);
try {
  if (modo === "--simular") await simular();
  else if (modo === "--aplicar" && pasta) await aplicar(path.resolve(pasta));
  else if (modo === "--reverter" && pasta) await reverter(path.resolve(pasta));
  else {
    console.error("Uso: node recalcular-regra-v2.mjs --simular | --aplicar <pasta> | --reverter <pasta>");
    process.exitCode = 1;
  }
} catch (erro) {
  console.error(`✖ ${erro.message}`);
  process.exitCode = 1;
}
