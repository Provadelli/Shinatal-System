// Avaliação de desempenho — média, faixas do conceito, linha do tempo e pendências
// (frontend/js/avaliacao-calculo.js). A média e as faixas são refeitas pela regra do Firestore
// no "ok" do Presidente (mediaConfere/conceitoDaMedia): estes casos valem para as duas.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcularMedia, conceitoPorMedia, passosDoCiclo, progressoDosPassos, calcularPendencias, avaliacoesConcluidas
} from "../../../frontend/js/avaliacao-calculo.js";

const r = (...notas) => ({ notas });

test("média de três avaliações: todas as 15 notas pesam igual", () => {
  assert.equal(calcularMedia([r(10, 10, 10, 10, 10), r(8, 8, 8, 8, 8), r(6, 6, 6, 6, 6)]), 8);
  assert.equal(calcularMedia([r(10, 9, 8, 7, 6), r(5, 5, 5, 5, 5), r(0, 0, 0, 0, 0)]), 4.3); // 65/15 = 4,333…
});

test("média arredonda a 1 casa (meio para cima)", () => {
  assert.equal(calcularMedia([r(9, 9, 9, 9, 9), r(9, 9, 9, 9, 8)]), 8.9); // 89/10
  assert.equal(calcularMedia([r(9, 9, 9, 9, 9), r(9, 9, 9, 9, 9), r(9, 9, 9, 9, 8)]), 8.9); // 134/15 = 8,933…
  assert.equal(calcularMedia([r(7, 7, 7, 7, 7), r(7, 7, 7, 7, 7), r(7, 7, 7, 7, 8)]), 7.1); // 106/15 = 7,066…
  assert.equal(calcularMedia([r(9, 9, 9, 9, 9), r(9, 9, 9, 9, 9), r(9, 9, 9, 9, 10)]), 9.1); // 136/15 = 9,066…
});

test("RH dispensado: média de duas avaliações; respostas nulas são ignoradas", () => {
  assert.equal(calcularMedia([r(10, 10, 10, 10, 10), null, r(6, 6, 6, 6, 6)]), 8);
  assert.equal(calcularMedia([]), null);
});

test("faixas do conceito nos limites", () => {
  assert.equal(conceitoPorMedia(10), "excelente");
  assert.equal(conceitoPorMedia(9), "excelente");
  assert.equal(conceitoPorMedia(8.9), "bom");
  assert.equal(conceitoPorMedia(7), "bom");
  assert.equal(conceitoPorMedia(6.9), "regular");
  assert.equal(conceitoPorMedia(5), "regular");
  assert.equal(conceitoPorMedia(4.9), "insatisfatorio");
  assert.equal(conceitoPorMedia(0), "insatisfatorio");
});

const ciclo = (extra = {}) => ({
  uid: "ana", ano: 2026, avaliadorUid: "bruno",
  concluidas: { presidente: false, rh: false, par: false }, rhDispensado: false,
  parecer: null, okPresidenteEm: null, ...extra
});

test("linha do tempo: o fio só avança na sequência contínua de etapas", () => {
  assert.equal(progressoDosPassos(passosDoCiclo(null)), 0);
  assert.equal(progressoDosPassos(passosDoCiclo(ciclo())), 0); // só a escolha: fio no 1º marco
  // O colega avaliou antes do Presidente: marco marcado, mas o fio fica na escolha.
  const foraDeOrdem = passosDoCiclo(ciclo({ concluidas: { presidente: false, rh: false, par: true } }));
  assert.equal(foraDeOrdem[3].feito, true);
  assert.equal(progressoDosPassos(foraDeOrdem), 0);
  const tresFeitas = passosDoCiclo(ciclo({ concluidas: { presidente: true, rh: true, par: true } }));
  assert.equal(progressoDosPassos(tresFeitas), 3 / 5);
  const final = passosDoCiclo(ciclo({ concluidas: { presidente: true, rh: true, par: true }, parecer: "ok", okPresidenteEm: 1 }));
  assert.equal(progressoDosPassos(final), 1);
});

test("RH dispensado conta como etapa concluída", () => {
  const c = ciclo({ concluidas: { presidente: true, rh: false, par: true }, rhDispensado: true });
  assert.equal(avaliacoesConcluidas(c), true);
  assert.equal(passosDoCiclo(c)[2].feito, true);
});

test("pendências por papel", () => {
  const aberto = ciclo();
  assert.deepEqual(calcularPendencias("presidente", "pres", [aberto]).map((p) => p.papel), ["presidente"]);
  assert.deepEqual(calcularPendencias("rh", "rh1", [aberto]).map((p) => p.papel), ["rh"]);
  assert.deepEqual(calcularPendencias("colaborador", "bruno", [aberto]).map((p) => p.papel), ["par"]);
  assert.equal(calcularPendencias("colaborador", "outro", [aberto]).length, 0);
  // O RH não avalia a si mesmo.
  assert.equal(calcularPendencias("rh", "ana", [aberto]).length, 0);
  // Parecer enviado: o Presidente tem um "ok" a dar.
  const comParecer = ciclo({ concluidas: { presidente: true, rh: true, par: true }, parecer: "Concordo." });
  assert.deepEqual(calcularPendencias("presidente", "pres", [comParecer]).map((p) => p.tipo), ["ok"]);
});
