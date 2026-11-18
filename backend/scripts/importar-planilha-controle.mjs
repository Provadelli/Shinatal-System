/**
 * Shinatal: reconcilia os contratos do sistema com a planilha de controle (auditável e idempotente).
 *
 * Fonte: backend/scripts/dados/planilha-controle-2026.json (cópia versionada da planilha).
 * Lógica pura em lib/planilha.mjs; cálculo em frontend/js/calculo-shinatal.js.
 *
 * Uso (dentro de backend/scripts, com service-account.json):
 *   node importar-planilha-controle.mjs --simular
 *       Só leitura. Grava backup + plano + relatório em out/planilha-<data-hora>/.
 *   node importar-planilha-controle.mjs --aplicar out/planilha-<data-hora>
 *       Aplica o plano daquela simulação. Aborta se o banco mudou depois da simulação, se houver
 *       solicitação pendente de contrato, divergência bloqueante, ou se o total dos contratos da
 *       planilha não bater com o esperado. Pode ser repetido sem duplicar nada.
 *   node importar-planilha-controle.mjs --reverter out/planilha-<data-hora>
 *       Devolve os campos alterados ao que estava no backup daquela simulação, acrescenta
 *       `reversao_planilha` (e `reversao_ajuste_manual`, se for o caso) ao histórico e remove só
 *       o contrato criado pela importação. Nenhuma entrada de histórico é apagada.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import admin from "firebase-admin";
import * as motor from "../../frontend/js/calculo-shinatal.js";
import * as util from "./lib/firestore-util.mjs";
import { planejarReconciliacao, aplicarPlanoEmMemoria, relatorioCSV, formatarReais, AUTOR_IMPORTACAO } from "./lib/planilha.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ARQUIVO_DADOS = path.join(DIR, "dados", "planilha-controle-2026.json");

const credencial = JSON.parse(fs.readFileSync(path.join(DIR, "service-account.json"), "utf8"));
admin.initializeApp({ credential: admin.credential.cert(credencial) });
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

const lerDados = () => JSON.parse(fs.readFileSync(ARQUIVO_DADOS, "utf8"));
const arred = (v) => Math.round((v || 0) * 100) / 100;

/** Totais do exercício só com os contratos da planilha (o que tem que bater com ela). */
function totaisDaPlanilha(contratos, dados, hojeISO) {
  const ids = new Set(dados.contratos.map((c) => c.docId));
  const daPlanilha = contratos.filter((c) => ids.has(c.id));
  const fundo = motor.calcularFundo(daPlanilha, dados.exercicio, hojeISO);
  const visao = motor.calcularVisaoSemestral(daPlanilha, dados.exercicio, hojeISO);
  return { fundo, visao, ativos: visao.total.ativos };
}

function conferirTotais(totais, dados) {
  const e = dados.totaisEsperados;
  const erros = [];
  const cmp = (rotulo, obtido, esperado) => {
    if (Math.abs(obtido - esperado) >= util.TOLERANCIA) erros.push(`${rotulo}: sistema ${obtido}, planilha ${esperado}`);
  };
  cmp("saldo", totais.fundo.saldoDisponivel, e.saldo);
  cmp("créditos brutos", totais.fundo.arrecadado, e.creditosBrutos);
  cmp("descontos de saída", totais.fundo.estornos, e.descontosSaida);
  cmp("funcionários ativos", totais.ativos, e.funcionariosAtivos);
  for (const s of ["1", "2"]) {
    cmp(`${s}º semestre ativos`, totais.visao.semestres[s].ativos, e.semestres[s].ativos);
    cmp(`${s}º semestre positivo`, totais.visao.semestres[s].positivo, e.semestres[s].positivo);
    cmp(`${s}º semestre negativo`, totais.visao.semestres[s].negativo, e.semestres[s].negativo);
  }
  return erros;
}

function imprimirPlano(plano, totaisAntes, totaisDepois, sistemaDepois) {
  for (const a of plano.acoes) {
    const marca = { criar: "+", atualizar: "~", igual: "=" }[a.tipo];
    const campos = (a.alteracoes || []).map((x) => x.campo).join(", ");
    console.log(`  ${marca} ${a.nomeEmpresa} (${a.id}): ${formatarReais(a.antes)} para ${formatarReais(a.depois)}${campos ? ` [${campos}]` : ""}`);
  }
  if (plano.divergencias.length) {
    console.log("\nDivergências:");
    for (const d of plano.divergencias) console.log(`  [${d.gravidade}] ${d.contrato}: ${d.mensagem}`);
  }
  if (plano.foraDaPlanilha.length) {
    console.log("\nContratos do sistema fora da planilha (não alterados):");
    for (const f of plano.foraDaPlanilha) console.log(`  ${f.excluidoDaTarefa ? "[FORA DA TAREFA] " : ""}${f.nomeEmpresa} (${f.id})`);
  }
  console.log(`\nContratos da planilha, exercício: saldo ${formatarReais(totaisAntes.fundo.saldoDisponivel)} hoje, ${formatarReais(totaisDepois.fundo.saldoDisponivel)} depois`);
  console.log(`  créditos ${formatarReais(totaisDepois.fundo.arrecadado)} | descontos ${formatarReais(totaisDepois.fundo.estornos)} | ativos ${totaisDepois.ativos}`);
  for (const s of ["1", "2"]) {
    const v = totaisDepois.visao.semestres[s];
    console.log(`  ${s}º semestre: ${v.ativos} ativos, positivo ${formatarReais(v.positivo)}, negativo ${formatarReais(v.negativo)}`);
  }
  console.log(`Sistema inteiro depois (inclui contratos fora da planilha): saldo ${formatarReais(sistemaDepois.saldoDisponivel)}`);
}

/* ------------------------------- modos ------------------------------- */

async function simular() {
  const hojeISO = motor.hojeISOLocal();
  const dados = lerDados();
  const banco = await util.carregar(db);
  const plano = planejarReconciliacao(banco.contratos, dados, hojeISO, hojeISO);
  const depois = aplicarPlanoEmMemoria(banco.contratos, plano);
  const totaisAntes = totaisDaPlanilha(banco.contratos, dados, hojeISO);
  const totaisDepois = totaisDaPlanilha(depois, dados, hojeISO);
  const errosTotais = conferirTotais(totaisDepois, dados);
  const sistemaDepois = motor.calcularFundo(depois, dados.exercicio, hojeISO);

  const pasta = path.join(DIR, "out", `planilha-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, "backup.json"), JSON.stringify(util.serializar({
    geradoEm: new Date().toISOString(), versaoRegra: motor.VERSAO_REGRA_CALCULO, hojeISO,
    contratosEmpresariais: banco.contratos, fundo: banco.fundos, estatisticasPublico: banco.publico
  }), null, 2));
  fs.writeFileSync(path.join(pasta, "plano.json"), JSON.stringify(util.serializar({
    origem: dados.origem, versaoRegra: motor.VERSAO_REGRA_CALCULO, hojeISO,
    hashes: Object.fromEntries(banco.contratos.map((c) => [c.id, util.hashContrato(c)])),
    pendentesContrato: banco.pendentesContrato.map((s) => ({ id: s.id, tipo: s.tipo, descricao: s.descricao })),
    totaisAntes, totaisDepois, errosTotais, sistemaDepois,
    plano
  }), null, 2));
  fs.writeFileSync(path.join(pasta, "relatorio.csv"), "﻿" + relatorioCSV(plano));

  console.log(`Planilha de controle: simulação (nenhuma gravação feita), referência ${hojeISO}`);
  imprimirPlano(plano, totaisAntes, totaisDepois, sistemaDepois);
  if (errosTotais.length) console.log(`\n✖ Totais não batem com a planilha:\n  ${errosTotais.join("\n  ")}`);
  else console.log("\n✔ Totais batem com a planilha.");
  if (banco.pendentesContrato.length) console.log(`⚠ ${banco.pendentesContrato.length} solicitação(ões) pendente(s) de contrato: resolva antes de --aplicar.`);
  console.log(`\nArquivos: ${pasta}`);
}

function lerSimulacao(pasta) {
  const arquivo = path.join(pasta, "plano.json");
  if (!fs.existsSync(arquivo) || !fs.existsSync(path.join(pasta, "backup.json"))) {
    throw new Error(`Simulação não encontrada em ${pasta} (rode --simular primeiro).`);
  }
  const salvo = JSON.parse(fs.readFileSync(arquivo, "utf8"));
  if (salvo.versaoRegra !== motor.VERSAO_REGRA_CALCULO) throw new Error(`A simulação é da régua ${salvo.versaoRegra}, mas o motor atual é ${motor.VERSAO_REGRA_CALCULO}.`);
  return salvo;
}

async function aplicar(pasta) {
  const salvo = lerSimulacao(pasta);
  const hojeISO = motor.hojeISOLocal();
  const dados = lerDados();
  const banco = await util.carregar(db);

  if (banco.pendentesContrato.length) {
    throw new Error(`Há ${banco.pendentesContrato.length} solicitação(ões) pendente(s) de contrato empresarial. Resolva-as e simule de novo.`);
  }
  const alterados = banco.contratos.filter((c) => salvo.hashes[c.id] && salvo.hashes[c.id] !== util.hashContrato(c)).map((c) => c.id);
  const novosNoBanco = banco.contratos.filter((c) => !salvo.hashes[c.id]).map((c) => c.id);
  const criadosPorNos = new Set(salvo.plano.acoes.filter((a) => a.tipo === "criar").map((a) => a.id));
  const inesperados = novosNoBanco.filter((id) => !criadosPorNos.has(id));
  if (alterados.length || inesperados.length) {
    // Exceção: uma aplicação anterior desta mesma simulação (reexecução) muda os próprios contratos.
    const plano = planejarReconciliacao(banco.contratos, dados, hojeISO, Timestamp.now());
    const pendentes = plano.acoes.filter((a) => a.tipo !== "igual");
    if (pendentes.length || inesperados.length) {
      throw new Error(`Contratos mudaram desde a simulação (alterados: ${alterados.join(", ") || "nenhum"}; novos: ${inesperados.join(", ") || "nenhum"}). Simule de novo.`);
    }
  }

  const plano = planejarReconciliacao(banco.contratos, dados, hojeISO, Timestamp.now());
  const bloqueantes = plano.divergencias.filter((d) => d.gravidade === "bloqueante");
  if (bloqueantes.length) {
    throw new Error(`Divergências bloqueantes:\n  ${bloqueantes.map((d) => `${d.contrato}: ${d.mensagem}`).join("\n  ")}`);
  }
  const errosTotais = conferirTotais(totaisDaPlanilha(aplicarPlanoEmMemoria(banco.contratos, plano), dados, hojeISO), dados);
  if (errosTotais.length) throw new Error(`Totais não batem com a planilha, nada foi gravado:\n  ${errosTotais.join("\n  ")}`);

  const registros = [];
  for (const acao of plano.acoes) {
    if (acao.tipo === "igual") { registros.push({ id: acao.id, nomeEmpresa: acao.nomeEmpresa, resultado: "igual" }); continue; }
    const ref = db.collection("contratosEmpresariais").doc(acao.id);
    const resultado = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (acao.tipo === "criar") {
        if (snap.exists) return "ja_existia";
        tx.create(ref, { ...acao.campos, registradoPor: AUTOR_IMPORTACAO, criadoEm: FieldValue.serverTimestamp() });
        return "criado";
      }
      if (!snap.exists) return "inexistente";
      // Reconfere dentro da transação: se outra execução já aplicou, não grava de novo.
      const atual = { id: snap.id, ...snap.data() };
      const replanejado = planejarReconciliacao([atual], { ...dados, contratos: dados.contratos.filter((c) => c.docId === acao.id), linhas: dados.linhas }, hojeISO, Timestamp.now());
      const minha = replanejado.acoes.find((a) => a.id === acao.id);
      if (!minha || minha.tipo === "igual") return "ja_aplicado";
      tx.update(ref, { ...minha.campos, historicoMovimentacoes: FieldValue.arrayUnion(...minha.entradasHistorico) });
      return "atualizado";
    });
    registros.push({ id: acao.id, nomeEmpresa: acao.nomeEmpresa, resultado, antes: acao.antes, depois: acao.depois, alteracoes: acao.alteracoes, porAno: acao.porAno });
    console.log(`  ${["criado", "atualizado"].includes(resultado) ? "✔" : "·"} ${acao.nomeEmpresa} (${acao.id}): ${resultado}`);
  }

  const atualizados = await util.carregar(db);
  const agregados = await util.republicarAgregados(db, FieldValue, AUTOR_IMPORTACAO, atualizados.contratos, atualizados.usuarios, Object.keys(banco.fundos), hojeISO);
  const divergenciasAgregados = await util.validarAgregados(db, hojeISO);
  const totaisFinais = totaisDaPlanilha(atualizados.contratos, dados, hojeISO);
  const errosFinais = conferirTotais(totaisFinais, dados);

  const resumo = {
    aplicadoEm: new Date().toISOString(), hojeISO, origem: dados.origem,
    criados: registros.filter((r) => r.resultado === "criado").length,
    atualizados: registros.filter((r) => r.resultado === "atualizado").length,
    iguais: registros.filter((r) => ["igual", "ja_aplicado", "ja_existia"].includes(r.resultado)).length,
    registros, foraDaPlanilha: plano.foraDaPlanilha, divergencias: plano.divergencias,
    agregados, divergenciasAgregados, totaisFinais, errosFinais
  };
  fs.writeFileSync(path.join(pasta, `aplicacao-${Date.now()}.json`), JSON.stringify(util.serializar(resumo), null, 2));
  console.log(`\nCriados: ${resumo.criados} | atualizados: ${resumo.atualizados} | sem alteração: ${resumo.iguais}`);
  console.log(`Contratos da planilha: saldo ${formatarReais(totaisFinais.fundo.saldoDisponivel)} | fundos republicados: ${agregados.anos.join(", ")}`);
  if (divergenciasAgregados.length || errosFinais.length) {
    console.error(divergenciasAgregados, errosFinais);
    process.exitCode = 2;
  }
}

async function reverter(pasta) {
  lerSimulacao(pasta);
  const hojeISO = motor.hojeISOLocal();
  const backup = JSON.parse(fs.readFileSync(path.join(pasta, "backup.json"), "utf8"));
  const anteriores = new Map(backup.contratosEmpresariais.map((c) => [c.id, c]));
  const banco = await util.carregar(db);
  const CAMPOS = ["prazoIndeterminado", "dataFimPrevista", "duracaoMesesPrevista", "saidasIniciais", "entradasContrato"];
  let revertidos = 0;
  let removidos = 0;

  for (const c of banco.contratos) {
    const importou = (c.historicoMovimentacoes || []).some((h) => h?.tipo === "importacao_planilha" && h.registradoPor === AUTOR_IMPORTACAO);
    if (!importou) continue;
    const antes = anteriores.get(c.id);
    if (!antes) {
      // Criado pela importação: o único documento que a reversão remove (o backup guarda o estado anterior: inexistente).
      await db.collection("contratosEmpresariais").doc(c.id).delete();
      removidos++;
      continue;
    }
    const campos = Object.fromEntries(CAMPOS.map((k) => [k, antes[k] === undefined ? FieldValue.delete() : antes[k]]));
    const valorAtual = motor.calcularResumoContratoEmpresarial(c, hojeISO).totalCreditadoFundo;
    const entradas = [{
      tipo: "reversao_planilha", versaoRegra: motor.VERSAO_REGRA_CALCULO,
      descricao: `Reversão da conferência pela planilha de controle: campos devolvidos ao estado do backup ${path.basename(pasta)}.`,
      motivo: "Reversão controlada da importação da planilha de controle.",
      fundoAntes: arred(valorAtual), fundoDepois: arred(valorAtual), diferenca: 0,
      data: Timestamp.now(), registradoPor: AUTOR_IMPORTACAO
    }];
    if (motor.obterAjusteManual(c) && !motor.obterAjusteManual(antes)) {
      entradas.push({
        tipo: "reversao_ajuste_manual", descricao: "Reversão do ajuste manual registrado pela importação da planilha.",
        motivo: "Reversão controlada da importação da planilha de controle.", fundoAntes: 0, fundoDepois: 0,
        data: Timestamp.now(), registradoPor: AUTOR_IMPORTACAO
      });
    }
    await db.collection("contratosEmpresariais").doc(c.id).update({ ...campos, historicoMovimentacoes: FieldValue.arrayUnion(...entradas) });
    revertidos++;
  }
  const atualizados = await util.carregar(db);
  const agregados = await util.republicarAgregados(db, FieldValue, AUTOR_IMPORTACAO, atualizados.contratos, atualizados.usuarios, Object.keys(atualizados.fundos), hojeISO);
  console.log(`Revertidos: ${revertidos} | criados pela importação e removidos: ${removidos} | fundos republicados: ${agregados.anos.join(", ")}.`);
}

/* ------------------------------- entrada ------------------------------- */

const [modo = "--simular", pasta] = process.argv.slice(2);
try {
  if (modo === "--simular") await simular();
  else if (modo === "--aplicar" && pasta) await aplicar(path.resolve(pasta));
  else if (modo === "--reverter" && pasta) await reverter(path.resolve(pasta));
  else {
    console.error("Uso: node importar-planilha-controle.mjs --simular | --aplicar <pasta> | --reverter <pasta>");
    process.exitCode = 1;
  }
} catch (erro) {
  console.error(`✖ ${erro.message}`);
  process.exitCode = 1;
}
