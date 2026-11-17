// Migração global: comparação régua antiga × nova, auditoria e idempotência.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as antigo from "../../scripts/legado/calculo-shinatal-v1.mjs";
import * as novo from "../../../frontend/js/calculo-shinatal.js";
import {
  planejarMigracao, compararContrato, jaMigrado, montarEntradaAuditoria, montarEntradaReversao, relatorioCSV
} from "../../scripts/lib/recalculo.mjs";

const HOJE = "2026-11-17";
const V = novo.VERSAO_REGRA_CALCULO;
const contrato = (extra = {}) => ({
  id: "x", nomeEmpresa: "Empresa", cnpj: "00000000000000",
  dataInicio: "2026-01-10", dataFimPrevista: "2026-12-31", dataFimPrevistaOriginal: "2026-12-31",
  quantidadeFuncionariosIniciais: 5, status: "ativo", dataEncerramentoReal: null,
  saidasIniciais: [], entradasContrato: [], pausas: [], pausasQuadroInicial: [], pausasEntradas: [],
  historicoMovimentacoes: [], ...extra
});

test("18. recálculo de contrato antigo: saída no meio do mês passa a descontar o mês", () => {
  const c = contrato({ saidasIniciais: [{ data: "2026-05-10" }] });
  const cmp = compararContrato(c, antigo, novo, [2026], HOJE);
  assert.equal(cmp.antes, 750 - 87.5); // regra antiga: maio contava
  assert.equal(cmp.depois, 750 - 100);
  assert.equal(cmp.diferenca, -12.5);
  assert.deepEqual(cmp.porAno[2026], { antes: 662.5, depois: 650, diferenca: -12.5 });
  assert.equal(cmp.alterado, true);
});

test("contrato sem nenhuma movimentação afetada não gera ajuste", () => {
  const cmp = compararContrato(contrato(), antigo, novo, [2026], HOJE);
  assert.equal(cmp.alterado, false);
});

test("contrato implantado em 15/12: crédito muda de exercício (auditado por ano)", () => {
  const c = contrato({ dataInicio: "2025-12-15", dataFimPrevistaOriginal: null, quantidadeFuncionariosIniciais: 1 });
  const cmp = compararContrato(c, antigo, novo, [2025, 2026], HOJE);
  assert.equal(cmp.porAno[2025].diferenca, -150);
  assert.equal(cmp.porAno[2026].diferenca, 150);
  assert.equal(cmp.alterado, true);
});

test("17. reprocessamento não duplica lançamentos (idempotência)", () => {
  const c = contrato({ saidasIniciais: [{ data: "2026-05-10" }] });
  const plano1 = planejarMigracao([c], antigo, novo, V, HOJE);
  assert.equal(plano1.analisados, 1);
  assert.equal(plano1.aAtualizar.length, 1);

  const entrada = montarEntradaAuditoria(plano1.aAtualizar[0], V, "2026-11-17");
  assert.equal(entrada.tipo, "recalculo_regra");
  assert.equal(entrada.fundoAntes, 662.5);
  assert.equal(entrada.fundoDepois, 650);
  const migrado = { ...c, historicoMovimentacoes: [entrada] };
  assert.equal(jaMigrado(migrado, V), true);

  const plano2 = planejarMigracao([migrado], antigo, novo, V, HOJE);
  assert.equal(plano2.aAtualizar.length, 0);
  assert.deepEqual(plano2.jaMigrados, ["x"]);

  // A entrada de auditoria não altera o cálculo do contrato.
  assert.equal(novo.calcularResumoContratoEmpresarial(migrado, HOJE).totalCreditadoFundo, 650);

  // Reversão registrada → volta a ser elegível, sem apagar a entrada original.
  const revertido = { ...migrado, historicoMovimentacoes: [entrada, montarEntradaReversao(migrado, V, "2026-11-18", 662.5)] };
  assert.equal(jaMigrado(revertido, V), false);
  assert.equal(revertido.historicoMovimentacoes.length, 2);
});

test("entradas comuns do portal com versaoRegra não contam como migração", () => {
  const c = contrato({ historicoMovimentacoes: [{ tipo: "criacao", versaoRegra: V, fundoAntes: 0, fundoDepois: 750 }] });
  assert.equal(jaMigrado(c, V), false);
});

test("plano global com vários contratos + relatório CSV", () => {
  const contratos = [
    contrato({ id: "a" }),
    contrato({ id: "b", saidasIniciais: [{ data: "2026-05-10" }] }),
    contrato({ id: "c", status: "encerrado", dataEncerramentoReal: "2026-06-18", quantidadeFuncionariosIniciais: 4,
      entradasContrato: [{ dataEntrada: "2026-03-20", quantidade: 2 }] }),
    contrato({ id: "d", prazoIndeterminado: true, dataFimPrevista: null, dataFimPrevistaOriginal: null })
  ];
  const plano = planejarMigracao(contratos, antigo, novo, V, HOJE);
  assert.equal(plano.analisados, 4);
  assert.deepEqual(plano.aAtualizar.map((c) => c.id).sort(), ["b", "c"]);
  const c = plano.comparacoes.find((x) => x.id === "c");
  assert.equal(c.antes, 412.5); // antigo: estorno proporcional sobre o total
  assert.equal(c.depois, 375);  // novo: estorno por lote
  const csv = relatorioCSV(plano.comparacoes);
  assert.equal(csv.split("\r\n").length, 5);
  assert.match(csv, /"c";"Empresa"/);
});
