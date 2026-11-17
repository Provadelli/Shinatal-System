// Contratos empresariais e Fundo Shinatal na régua v2 — cálculo por lote de funcionários.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcularResumoContratoEmpresarial as resumo, calcularFundo, calcularContribuicaoNoAno, montarAgregadosFundo
} from "../../../frontend/js/calculo-shinatal.js";

const HOJE = "2026-11-17";
const base = (extra = {}) => ({
  dataInicio: "2026-01-10", dataFimPrevista: "2026-12-31", dataFimPrevistaOriginal: "2026-12-31",
  quantidadeFuncionariosIniciais: 5, status: "ativo", dataEncerramentoReal: null,
  saidasIniciais: [], entradasContrato: [], pausas: [], pausasQuadroInicial: [], pausasEntradas: [],
  ...extra
});
const loteAberto = (r) => r.lotes.find((l) => !l.saida);

test("crédito inicial: R$ 12,50 × funcionários × meses vigentes (teto 12)", () => {
  assert.equal(resumo(base(), HOJE).creditoInicial, 750);
  // Início no dia 15: conta a partir de fevereiro → 11 meses.
  assert.equal(resumo(base({ dataInicio: "2026-01-15", dataFimPrevistaOriginal: null }), HOJE).creditoInicial, 12.5 * 5 * 11);
  // Contrato de 18 meses: teto de 12.
  assert.equal(resumo(base({ dataFimPrevista: "2027-06-30", dataFimPrevistaOriginal: "2027-06-30" }), HOJE).creditoInicial, 750);
});

test("7. desligamento de 1 entre 5 não altera o cálculo dos outros 4", () => {
  const sem = resumo(base(), HOJE);
  const com = resumo(base({ saidasIniciais: [{ data: "2026-05-10" }] }), HOJE);
  const desligado = com.lotes.find((l) => l.saida);
  assert.equal(desligado.mesesContados, 4); // jan–abr; maio não conta
  assert.equal(desligado.desconto, 12.5 * 1 * 8);
  // Os 4 que ficaram: mesmos meses contados e mesmo valor por pessoa de antes.
  assert.equal(loteAberto(com).quantidade, 4);
  assert.equal(loteAberto(com).mesesContados, loteAberto(sem).mesesContados);
  assert.equal(loteAberto(com).mesesCreditados, 12);
  assert.equal(loteAberto(com).estornoProjetado / 4, loteAberto(sem).estornoProjetado / 5);
  assert.equal(com.totalCreditadoFundo, 750 - 100);
});

test("desligamento no último dia do mês conta o mês", () => {
  const r = resumo(base({ saidasIniciais: [{ data: "2026-05-31" }] }), HOJE);
  assert.equal(r.lotes.find((l) => l.saida).desconto, 12.5 * 7);
});

test("10. entrada individual durante o contrato (dia 20 → começa no mês seguinte)", () => {
  const r = resumo(base({ entradasContrato: [{ dataEntrada: "2026-03-20", quantidade: 2 }] }), HOJE);
  const entrada = r.lotes.find((l) => l.origem === "entrada");
  assert.equal(entrada.mesesCreditados, 9); // abr–dez
  assert.equal(entrada.credito, 225);
  assert.equal(r.totalCreditado, 750 + 225);
  // Entrada no dia 14 conta o próprio mês.
  const r14 = resumo(base({ entradasContrato: [{ dataEntrada: "2026-03-14" }] }), HOJE);
  assert.equal(r14.lotes.find((l) => l.origem === "entrada").mesesCreditados, 10);
});

test("8/9/14. encerramento antecipado no meio do mês com vários lotes: estorno por funcionário", () => {
  const c = base({
    quantidadeFuncionariosIniciais: 4, status: "encerrado", dataEncerramentoReal: "2026-06-18",
    entradasContrato: [{ dataEntrada: "2026-03-20", quantidade: 2 }]
  });
  const r = resumo(c, HOJE);
  // Quadro inicial: 12 creditados, 6 contados (jan–jun) → 4 × 6 × 12,50 = 300.
  // Entrada: 9 creditados (abr–dez), 3 contados (abr–jun) → 2 × 6 × 12,50 = 150.
  assert.equal(r.totalCreditado, 600 + 225);
  assert.equal(r.estorno, 450);
  assert.equal(r.totalCreditadoFundo, 375);
  assert.equal(r.movimentos.find((m) => m.tipo === "estorno").data, "2026-06-18");
});

test("término no prazo previsto: sem estorno", () => {
  const r = resumo(base({ status: "encerrado", dataEncerramentoReal: "2026-12-05" }), HOJE);
  assert.equal(r.estorno, 0);
  assert.equal(r.totalCreditadoFundo, 750);
});

test("contrato ativo: estorno é só projetado, não sai do fundo", () => {
  const r = resumo(base(), HOJE);
  assert.equal(r.estorno, 12.5 * 5 * 1); // dezembro ainda não decorrido
  assert.equal(r.totalCreditadoFundo, 750);
  assert.equal(r.movimentos.some((m) => m.tipo === "estorno"), false);
});

test("11. prazo indeterminado: R$150 por funcionário, desconto/estorno pelos meses que faltaram", () => {
  const c = {
    prazoIndeterminado: true, dataInicio: "2026-01-05", dataFimPrevista: null, quantidadeFuncionariosIniciais: 10,
    status: "encerrado", dataEncerramentoReal: "2026-05-20",
    saidasIniciais: [{ data: "2026-03-31", quantidade: 2 }], entradasContrato: [], pausas: []
  };
  const r = resumo(c, HOJE);
  assert.equal(r.creditoInicial, 1500);
  assert.equal(r.lotes.find((l) => l.saida).desconto, 12.5 * 2 * 9); // jan–mar contados
  assert.equal(r.estorno, 12.5 * 8 * 7); // 8 restantes, jan–mai contados
  assert.equal(r.totalCreditadoFundo, 1500 - 225 - 700);
  // Ativo há mais de 12 meses: nada a estornar.
  const longo = resumo({ ...c, status: "ativo", dataEncerramentoReal: null, saidasIniciais: [], dataInicio: "2025-01-05" }, "2026-03-10");
  assert.equal(longo.estorno, 0);
});

test("12. pausa do contrato inteiro e pausa parcial do quadro", () => {
  const inteiro = resumo(base({
    quantidadeFuncionariosIniciais: 4, status: "encerrado", dataEncerramentoReal: "2026-12-31",
    pausas: [{ dataPausa: "2026-03-10", dataRetomada: "2026-05-10" }]
  }), HOJE);
  assert.equal(inteiro.mesesPausados, 2);
  assert.equal(inteiro.estorno, 12.5 * 4 * 2);

  const parcial = resumo(base({
    quantidadeFuncionariosIniciais: 4, status: "encerrado", dataEncerramentoReal: "2026-12-31",
    pausasQuadroInicial: [{ dataPausa: "2026-03-10", dataRetomada: "2026-05-10", quantidade: 2 }]
  }), HOJE);
  assert.equal(parcial.funcionarioMesesPausados, 4);
  assert.equal(parcial.estorno, 50);
  assert.equal(parcial.totalCreditadoFundo, 550);
});

test("13. alteração de vigência: ajuste de prazo datado na alteração", () => {
  const c = base({
    quantidadeFuncionariosIniciais: 2, dataFimPrevistaOriginal: "2026-06-30",
    historicoMovimentacoes: [{ tipo: "edicao_prazo", descricao: "Prazo alterado", data: "2026-07-01" }]
  });
  const r = resumo(c, HOJE);
  assert.equal(r.creditoInicial, 300);
  assert.equal(r.ajustePrazo, 150);
  assert.deepEqual(r.movimentos.find((m) => m.tipo === "prazo"), { tipo: "prazo", data: "2026-07-01", valor: 150 });
  assert.equal(r.acrescido, 150);
});

test("15. virada de ano: crédito de contrato iniciado em 15/12 entra no exercício seguinte", () => {
  const c = base({ dataInicio: "2025-12-15", quantidadeFuncionariosIniciais: 1, dataFimPrevistaOriginal: null });
  assert.equal(calcularFundo([c], 2025, HOJE).arrecadado, 0);
  assert.equal(calcularFundo([c], 2026, HOJE).arrecadado, 150);
  const c14 = { ...c, dataInicio: "2025-12-14" };
  assert.equal(calcularFundo([c14], 2025, HOJE).arrecadado, 150);
  // Saída em 2026 de contrato implantado em 2025 desconta do fundo de 2026.
  const saida = { ...c14, saidasIniciais: [{ data: "2026-03-10" }] };
  assert.equal(calcularContribuicaoNoAno(saida, 2026, HOJE).descontado, 12.5 * 9); // dez–fev contados
});

test("combinação: entrada + saídas + pausa + encerramento antecipado", () => {
  const c = base({
    quantidadeFuncionariosIniciais: 3, status: "encerrado", dataEncerramentoReal: "2026-10-10",
    saidasIniciais: [{ data: "2026-04-30" }],
    entradasContrato: [{ dataEntrada: "2026-02-14", dataSaida: "2026-08-15", quantidade: 2 }],
    pausas: [{ dataPausa: "2026-06-10", dataRetomada: "2026-07-20" }]
  });
  const r = resumo(c, HOJE);
  // Inicial que saiu em 30/04: jan–abr = 4 → desconto 8 × 12,50 = 100.
  // Entrada (fev–dez = 11 → R$275), saiu 15/08: fev–jul menos jun/jul pausados = 4 → desconto 7 × 2 × 12,50 = 175.
  // 2 iniciais até 10/10: jan–out menos jun/jul = 8 → estorno 4 × 2 × 12,50 = 100.
  assert.equal(r.totalCreditado, 450 + 275 - 100 - 175);
  assert.equal(r.estorno, 100);
  assert.equal(r.totalCreditadoFundo, 350);
  const fundo = calcularFundo([c], 2026, HOJE);
  assert.equal(fundo.saldoDisponivel, 350);
});

test("estorno nunca ultrapassa o total creditado e o saldo nunca fica negativo", () => {
  const c = base({ quantidadeFuncionariosIniciais: 1, status: "encerrado", dataEncerramentoReal: "2026-01-12",
    pausasQuadroInicial: [{ dataPausa: "2026-01-10", dataRetomada: null, quantidade: 5 }] });
  const r = resumo(c, HOJE);
  assert.ok(r.estorno <= r.totalCreditado);
  assert.ok(r.totalCreditadoFundo >= 0);
});

test("19. consistência banco × interface: agregados publicados = cálculo das telas", () => {
  const contratos = [
    base({ id: "a" }),
    base({ id: "b", status: "encerrado", dataEncerramentoReal: "2026-06-18", quantidadeFuncionariosIniciais: 4,
      entradasContrato: [{ dataEntrada: "2026-03-20", quantidade: 2 }] })
  ];
  const usuarios = [{ uid: "u1", status: "ativo", dataAdmissao: "2020-01-01", cargaHoraria: 8 }];
  const { fundo, publico } = montarAgregadosFundo(contratos, usuarios, 2026, HOJE);
  const tela = calcularFundo(contratos, 2026, HOJE);
  assert.equal(fundo.saldoDisponivel, tela.saldoDisponivel);
  assert.equal(fundo.arrecadado, tela.arrecadado);
  assert.equal(fundo.estornos, tela.estornos);
  assert.equal(publico.arrecadado, tela.saldoDisponivel);
  assert.equal(publico.colaboradores, 5 + 6);
  assert.equal(fundo.somaPesos, 1);
  const somaContratos = contratos.reduce((s, c) => s + calcularContribuicaoNoAno(c, 2026, HOJE).liquido, 0);
  assert.equal(somaContratos, tela.saldoDisponivel);
});
