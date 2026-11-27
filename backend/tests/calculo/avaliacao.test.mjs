// Avaliação de desempenho — média, faixas do conceito, linha do tempo, pendências
// (frontend/js/avaliacao-calculo.js) e a resolução da tabela de avaliadores fixos
// (backend/scripts/lib/avaliadores-fixos.mjs). A média e as faixas são refeitas pela regra do
// Firestore no "ok" do Presidente (mediaConfere/conceitoDaMedia): estes casos valem para as duas.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcularMedia, conceitoPorMedia, passosDoCiclo, progressoDosPassos, calcularPendencias, avaliacoesConcluidas, NOTA_MAXIMA
} from "../../../frontend/js/avaliacao-calculo.js";
import { resolverTabela, normalizarNome, TABELA_AVALIADORES_FIXOS } from "../../scripts/lib/avaliadores-fixos.mjs";

const r = (...notas) => ({ notas });

test("escala de 0 a 5", () => {
  assert.equal(NOTA_MAXIMA, 5);
});

test("média de duas avaliações: as 10 notas pesam igual", () => {
  assert.equal(calcularMedia([r(5, 5, 5, 5, 5), r(3, 3, 3, 3, 3)]), 4); // 40/10
  assert.equal(calcularMedia([r(5, 4, 3, 2, 1), r(0, 0, 0, 0, 0)]), 1.5); // 15/10
});

test("média arredonda a 1 casa (meio para cima)", () => {
  assert.equal(calcularMedia([r(5, 5, 5, 5, 5), r(5, 5, 5, 5, 4)]), 4.9); // 49/10
  assert.equal(calcularMedia([r(4, 4, 4, 4, 4), r(4, 4, 4, 4, 3)]), 3.9); // 39/10
  assert.equal(calcularMedia([r(5, 5, 5, 5, 5)]), 5);
  assert.equal(calcularMedia([r(4, 4, 4, 4, 5), r(5, 5, 5, 5, 5), r(5, 5, 5, 5, 5)]), 4.7); // 71/15 = 4,733…
  assert.equal(calcularMedia([r(4, 4, 4, 4, 5), r(4, 4, 4, 4, 5), r(5, 5, 5, 5, 5)]), 4.5); // 67/15 = 4,466…
});

test("respostas ausentes são ignoradas; sem notas não há média", () => {
  assert.equal(calcularMedia([r(5, 5, 5, 5, 5), null]), 5);
  assert.equal(calcularMedia([]), null);
});

test("faixas do conceito nos limites (0 a 5)", () => {
  assert.equal(conceitoPorMedia(5), "excelente");
  assert.equal(conceitoPorMedia(4.5), "excelente");
  assert.equal(conceitoPorMedia(4.4), "bom");
  assert.equal(conceitoPorMedia(3.5), "bom");
  assert.equal(conceitoPorMedia(3.4), "regular");
  assert.equal(conceitoPorMedia(2.5), "regular");
  assert.equal(conceitoPorMedia(2.4), "insatisfatorio");
  assert.equal(conceitoPorMedia(0), "insatisfatorio");
});

const ciclo = (extra = {}) => ({
  uid: "ana", ano: 2026, avaliadorFixoUid: "pres", avaliadorEscolhidoUid: "bruno",
  concluidas: { fixo: false, escolhido: false }, respostaEnviadaEm: null, okPresidenteEm: null, ...extra
});

test("linha do tempo: 5 marcos; o fio só avança na sequência contínua", () => {
  assert.equal(passosDoCiclo(null).length, 5);
  assert.equal(progressoDosPassos(passosDoCiclo(null)), 0);
  assert.equal(progressoDosPassos(passosDoCiclo(ciclo())), 0); // só a escolha: fio no 1º marco
  // O colega avaliou antes do fixo: marco marcado, mas o fio fica na escolha.
  const foraDeOrdem = passosDoCiclo(ciclo({ concluidas: { fixo: false, escolhido: true } }));
  assert.equal(foraDeOrdem[2].feito, true);
  assert.equal(progressoDosPassos(foraDeOrdem), 0);
  const duasFeitas = passosDoCiclo(ciclo({ concluidas: { fixo: true, escolhido: true } }));
  assert.equal(progressoDosPassos(duasFeitas), 2 / 4);
  const final = passosDoCiclo(ciclo({ concluidas: { fixo: true, escolhido: true }, respostaEnviadaEm: 1, okPresidenteEm: 1 }));
  assert.equal(progressoDosPassos(final), 1);
});

test("avaliações concluídas só com o fixo e o escolhido", () => {
  assert.equal(avaliacoesConcluidas(ciclo({ concluidas: { fixo: true, escolhido: false } })), false);
  assert.equal(avaliacoesConcluidas(ciclo({ concluidas: { fixo: true, escolhido: true } })), true);
  assert.equal(avaliacoesConcluidas(null), false);
});

test("pendências: fixo e escolhido avaliam; o Presidente dá o ok depois da resposta", () => {
  const aberto = ciclo();
  assert.deepEqual(calcularPendencias("presidente", "pres", [aberto]).map((p) => p.papel), ["fixo"]);
  assert.deepEqual(calcularPendencias("colaborador", "bruno", [aberto]).map((p) => p.papel), ["escolhido"]);
  assert.equal(calcularPendencias("colaborador", "outro", [aberto]).length, 0);
  // RH não tem mais pendência automática.
  assert.equal(calcularPendencias("rh", "rh1", [aberto]).length, 0);
  // Fixo que não é o Presidente (ex.: Erickson avalia o Kleber).
  const kleber = ciclo({ uid: "kleber", avaliadorFixoUid: "erickson" });
  assert.deepEqual(calcularPendencias("colaborador", "erickson", [kleber]).map((p) => p.papel), ["fixo"]);
  // Avaliações feitas, sem resposta: o Presidente ainda não tem ok a dar.
  const avaliado = ciclo({ concluidas: { fixo: true, escolhido: true } });
  assert.equal(calcularPendencias("presidente", "pres", [avaliado]).length, 0);
  const respondido = ciclo({ concluidas: { fixo: true, escolhido: true }, respostaEnviadaEm: 1 });
  assert.deepEqual(calcularPendencias("presidente", "pres", [respondido]).map((p) => p.tipo), ["ok"]);
  assert.equal(calcularPendencias("presidente", "pres", [{ ...respondido, okPresidenteEm: 1 }]).length, 0);
});

/* ---------------- Tabela de avaliadores fixos ---------------- */

const u = (uid, nome, extra = {}) => ({ uid, nome, role: "colaborador", status: "ativo", ...extra });
const CADASTROS = [
  u("edu", "Eduardo Lima", { role: "presidente" }), u("nat", "Natália Rocha"), u("gui", "Guido Alves"),
  u("dan", "Danilo Reis"), u("ped", "Pedro Lucas Mota"), u("mar", "Marcelo Dias"), u("dav", "David Melo"),
  u("day", "Dayane Costa"), u("eri", "Erickson Paz"), u("jul", "Juliana Freitas"), u("kle", "Kleber Nunes"),
  u("anj", "Ana Júlia Prado"), u("ana2", "Ana Souza"), u("pedro2", "Pedro Henrique")
];

test("tabela oficial resolve as 11 linhas, sem acento nem sobrenome", () => {
  const { pares, erros } = resolverTabela(TABELA_AVALIADORES_FIXOS, CADASTROS);
  assert.deepEqual(erros, []);
  assert.equal(Object.keys(pares).length, 11);
  assert.equal(pares.nat, "edu");
  assert.equal(pares.kle, "eri");
  assert.equal(pares.anj, "day");
  assert.equal(pares.ped, "edu");
  assert.equal(pares.pedro2, undefined); // "Pedro Lucas" não casa com "Pedro Henrique"
  assert.equal(pares.edu, undefined); // o Presidente não é avaliado
});

test("nome sem cadastro fica de fora sem bloquear; ambíguo bloqueia (nada é adivinhado)", () => {
  const ausente = resolverTabela([{ avaliado: "Zé", avaliador: "Eduardo" }, { avaliado: "Guido", avaliador: "Marcelo" }], CADASTROS);
  assert.deepEqual(ausente.erros, []);
  assert.deepEqual(ausente.semCadastro, ["Zé"]);
  assert.deepEqual(ausente.pares, { gui: "mar" });
  const duplicado = [...CADASTROS, u("gui2", "Guido Ramos")];
  assert.match(resolverTabela([{ avaliado: "Guido", avaliador: "Marcelo" }], duplicado).erros[0], /2 cadastros/);
  const desligado = CADASTROS.map((c) => (c.uid === "dav" ? { ...c, status: "demitido" } : c));
  assert.deepEqual(resolverTabela([{ avaliado: "David", avaliador: "Marcelo" }], desligado).semCadastro, ["David"]);
  // Desempate por e-mail.
  const comEmail = duplicado.map((c) => ({ ...c, email: `${c.uid}@shinerio.com` }));
  const ok = resolverTabela([{ avaliado: "Guido", emailAvaliado: "gui2@shinerio.com", avaliador: "Marcelo" }], comEmail);
  assert.deepEqual(ok.erros, []);
  assert.equal(ok.pares.gui2, "mar");
});

test("Presidente não é avaliado; ninguém avalia a si mesmo", () => {
  assert.match(resolverTabela([{ avaliado: "Eduardo", avaliador: "Marcelo" }], CADASTROS).erros[0], /Presidente/);
  assert.match(resolverTabela([{ avaliado: "Marcelo", avaliador: "Marcelo" }], CADASTROS).erros[0], /a si mesmo/);
  assert.equal(normalizarNome("  Ana   JÚLIA "), "ana julia");
});
