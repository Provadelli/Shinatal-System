// Suite de auditoria de segurança de backend/firestore.rules.
//
// Roda 100% contra o Firebase Emulator (projeto fictício "demo-shinatal" — o prefixo "demo-"
// faz o emulador operar totalmente offline, sem tocar o projeto real "shinetal-cda20" nem exigir
// credenciais). Cada bloco cobre o equivalente funcional de BOLA/IDOR, escalonamento de papel e
// mass assignment que um "Partner Test" de API cobriria em endpoints REST — aqui os "endpoints"
// são os pares match/allow das regras.
//
// Rodar (a partir da raiz do repositório):
//   cd backend/tests/rules && npm install
//   npm test

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, collection } from "firebase/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = path.join(__dirname, "../../firestore.rules");
const DOMINIO = "@shinerio.com";

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-shinatal",
    firestore: {
      rules: readFileSync(RULES_PATH, "utf8"),
      host: "127.0.0.1",
      port: 8080
    }
  });
});

after(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

/** Contexto autenticado com claims de e-mail equivalentes ao token real do Firebase Auth. */
function ctx(uid, { email = `${uid}${DOMINIO}`, emailVerificado = true } = {}) {
  return testEnv.authenticatedContext(uid, { email, email_verified: emailVerificado });
}

function anon() {
  return testEnv.unauthenticatedContext();
}

/** Escreve dados direto, ignorando as regras — para preparar cenários de teste. */
async function semRegras(fn) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await fn(context.firestore());
  });
}

async function seedUsuario(uid, role, extra = {}) {
  await semRegras((db) =>
    setDoc(doc(db, "usuarios", uid), {
      nome: uid,
      email: `${uid}${DOMINIO}`,
      cargaHoraria: 220,
      status: "ativo",
      role,
      ...extra
    })
  );
}

/** Cadastro em espera (cadastrosPendentes) escrito direto, ignorando as regras — o que o Worker/cadastro.html gravam. */
async function seedPendente(uid, extra = {}) {
  await semRegras((db) =>
    setDoc(doc(db, "cadastrosPendentes", uid), {
      nome: `Colab ${uid}`,
      email: `${uid}${DOMINIO}`,
      cargo: "Operações",
      cargaHoraria: 8,
      dataAdmissao: "2026-01-01",
      fotoBase64: null,
      ...extra
    })
  );
}

// ---------------------------------------------------------------------------
// usuarios/{uid}
// ---------------------------------------------------------------------------
describe("usuarios/{uid}", () => {
  it("colaborador lê o próprio perfil", async () => {
    await seedUsuario("colabA", "colaborador");
    const db = ctx("colabA").firestore();
    await assertSucceeds(getDoc(doc(db, "usuarios", "colabA")));
  });

  it("BOLA: colaborador NÃO lê perfil de outro colaborador", async () => {
    await seedUsuario("colabA", "colaborador");
    await seedUsuario("colabB", "colaborador");
    const db = ctx("colabA").firestore();
    await assertFails(getDoc(doc(db, "usuarios", "colabB")));
  });

  it("DP lê perfil de qualquer colaborador", async () => {
    await seedUsuario("dp1", "dp");
    await seedUsuario("colabB", "colaborador");
    const db = ctx("dp1").firestore();
    await assertSucceeds(getDoc(doc(db, "usuarios", "colabB")));
  });

  // --- Criação: o perfil só nasce com e-mail CONFIRMADO, a partir de um cadastro pendente --------
  // (o bug corrigido: cadastro com e-mail inexistente aparecia no painel sem nunca confirmar).

  /** Perfil completo que promoverCadastroPendente() (auth.js) grava — base para variar por teste. */
  function perfilPromovido(uid, extra = {}) {
    return {
      nome: `Colab ${uid}`,
      email: `${uid}${DOMINIO}`,
      cargo: "Operações",
      cargaHoraria: 8,
      fotoBase64: null,
      role: "colaborador",
      status: "ativo",
      motivoPerdaIntegral: null,
      dataAdmissao: "2026-01-01",
      dataDesligamento: null,
      criadoEm: "placeholder",
      ...extra
    };
  }

  it("BUG CORRIGIDO: e-mail NÃO confirmado não cria usuarios/{uid}, mesmo com cadastro pendente", async () => {
    await seedPendente("fantasma");
    const db = ctx("fantasma", { emailVerificado: false }).firestore();
    await assertFails(setDoc(doc(db, "usuarios", "fantasma"), perfilPromovido("fantasma")));
  });

  it("e-mail confirmado, mas SEM cadastro pendente, não cria usuarios/{uid} (tem que passar pelo cadastro)", async () => {
    const db = ctx("colabSemPendente").firestore();
    await assertFails(setDoc(doc(db, "usuarios", "colabSemPendente"), perfilPromovido("colabSemPendente")));
  });

  it("autocadastro com e-mail fora do domínio institucional falha", async () => {
    await seedPendente("intruso", { email: "intruso@gmail.com" });
    const db = ctx("intruso", { email: "intruso@gmail.com" }).firestore();
    await assertFails(
      setDoc(doc(db, "usuarios", "intruso"), perfilPromovido("intruso", { email: "intruso@gmail.com" }))
    );
  });

  it("regex de domínio não é enganado por sufixo (attacker@shinerio.com.evil.io)", async () => {
    await seedPendente("intruso2", { email: "intruso2@shinerio.com.evil.io" });
    const db = ctx("intruso2", { email: "intruso2@shinerio.com.evil.io" }).firestore();
    await assertFails(
      setDoc(doc(db, "usuarios", "intruso2"), perfilPromovido("intruso2", { email: "intruso2@shinerio.com.evil.io" }))
    );
  });

  it("autocadastro tentando nascer como admin falha (só 'colaborador' é permitido)", async () => {
    await seedPendente("colabC");
    const db = ctx("colabC").firestore();
    await assertFails(setDoc(doc(db, "usuarios", "colabC"), perfilPromovido("colabC", { role: "admin" })));
  });

  it("mass assignment: create NÃO aceita campos extras não previstos pelo app (remediado com hasOnly)", async () => {
    await seedPendente("colabD");
    const db = ctx("colabD").firestore();
    await assertFails(
      setDoc(doc(db, "usuarios", "colabD"), perfilPromovido("colabD", { campoNaoPrevisto: "valor-injetado-pelo-cliente" }))
    );
  });

  it("create com o schema completo legítimo (promoção do cadastro pendente, auth.js) funciona", async () => {
    await seedPendente("colabD2");
    const db = ctx("colabD2").firestore();
    await assertSucceeds(setDoc(doc(db, "usuarios", "colabD2"), perfilPromovido("colabD2")));
  });

  it("create de perfil de colaborador convidado por Admin (criadoPor igual ao do pendente) funciona", async () => {
    await seedPendente("colabD3", { criadoPor: "admin1" });
    const db = ctx("colabD3").firestore();
    await assertSucceeds(setDoc(doc(db, "usuarios", "colabD3"), perfilPromovido("colabD3", { criadoPor: "admin1" })));
  });

  it("criadoPor forjado no perfil (diferente do cadastro pendente) falha", async () => {
    await seedPendente("colabD4");
    const db = ctx("colabD4").firestore();
    await assertFails(setDoc(doc(db, "usuarios", "colabD4"), perfilPromovido("colabD4", { criadoPor: "admin1" })));
  });

  it("e-mail do perfil diferente do e-mail da conta falha", async () => {
    await seedPendente("colabD5");
    const db = ctx("colabD5").firestore();
    await assertFails(
      setDoc(doc(db, "usuarios", "colabD5"), perfilPromovido("colabD5", { email: "outra.pessoa@shinerio.com" }))
    );
  });

  it("Admin NÃO cria usuarios/{uid} de terceiros direto (nem com pendente e e-mail 'confirmado' — ninguém garante isso por ele)", async () => {
    await seedUsuario("admin1", "admin");
    await seedPendente("colabD6", { criadoPor: "admin1" });
    const db = ctx("admin1").firestore();
    await assertFails(setDoc(doc(db, "usuarios", "colabD6"), perfilPromovido("colabD6", { criadoPor: "admin1" })));
  });

  it("e-mail não confirmado NÃO lê nem o próprio perfil", async () => {
    await seedUsuario("colabK", "colaborador");
    const db = ctx("colabK", { emailVerificado: false }).firestore();
    await assertFails(getDoc(doc(db, "usuarios", "colabK")));
  });

  it("colaborador edita o próprio nome e foto", async () => {
    await seedUsuario("colabE", "colaborador");
    const db = ctx("colabE").firestore();
    await assertSucceeds(updateDoc(doc(db, "usuarios", "colabE"), { nome: "Novo Nome" }));
  });

  it("escalonamento de papel: colaborador NÃO consegue se autopromover a admin", async () => {
    await seedUsuario("colabF", "colaborador");
    const db = ctx("colabF").firestore();
    await assertFails(updateDoc(doc(db, "usuarios", "colabF"), { role: "admin" }));
  });

  it("escalonamento de papel: colaborador NÃO consegue alterar o próprio status via campo extra", async () => {
    await seedUsuario("colabG", "colaborador");
    const db = ctx("colabG").firestore();
    await assertFails(updateDoc(doc(db, "usuarios", "colabG"), { status: "inativo" }));
  });

  it("escalonamento de papel: admin NÃO consegue promover ninguém a presidente", async () => {
    await seedUsuario("admin1", "admin");
    await seedUsuario("colabH", "colaborador");
    const db = ctx("admin1").firestore();
    await assertFails(updateDoc(doc(db, "usuarios", "colabH"), { role: "presidente" }));
  });

  it("presidente pode promover alguém a presidente", async () => {
    await seedUsuario("pres1", "presidente");
    await seedUsuario("colabI", "colaborador");
    const db = ctx("pres1").firestore();
    await assertSucceeds(updateDoc(doc(db, "usuarios", "colabI"), { role: "presidente" }));
  });

  it("delete exige e-mail verificado, mesmo para admin", async () => {
    await seedUsuario("admin2", "admin");
    await seedUsuario("colabJ", "colaborador");
    const db = ctx("admin2", { emailVerificado: false }).firestore();
    await assertFails(deleteDoc(doc(db, "usuarios", "colabJ")));
  });
});

// ---------------------------------------------------------------------------
// cadastrosPendentes/{uid} — cadastro em espera, ANTES da confirmação do e-mail
// ---------------------------------------------------------------------------
describe("cadastrosPendentes/{uid}", () => {
  /** Documento que o Worker/cadastro.html gravam (sem role/status — esses só existem no perfil). */
  function pendente(uid, extra = {}) {
    return {
      nome: `Colab ${uid}`,
      email: `${uid}${DOMINIO}`,
      cargo: "Operações",
      cargaHoraria: 8,
      dataAdmissao: "2026-01-01",
      fotoBase64: null,
      criadoEm: "placeholder",
      ...extra
    };
  }

  it("dono com e-mail NÃO confirmado cria o próprio cadastro pendente (é o momento do cadastro)", async () => {
    const db = ctx("novo1", { emailVerificado: false }).firestore();
    await assertSucceeds(setDoc(doc(db, "cadastrosPendentes", "novo1"), pendente("novo1")));
  });

  it("um cadastro pendente NÃO cria colaborador: nada aparece em usuarios/", async () => {
    const db = ctx("novo2", { emailVerificado: false }).firestore();
    await assertSucceeds(setDoc(doc(db, "cadastrosPendentes", "novo2"), pendente("novo2")));
    await semRegras(async (dbAdmin) => {
      const snap = await getDoc(doc(dbAdmin, "usuarios", "novo2"));
      assert.equal(snap.exists(), false);
    });
  });

  it("BOLA: não cria o cadastro pendente de OUTRO uid", async () => {
    const db = ctx("novo3", { emailVerificado: false }).firestore();
    await assertFails(setDoc(doc(db, "cadastrosPendentes", "outroUid"), pendente("novo3")));
  });

  it("mass assignment: role/status não são aceitos no cadastro pendente (hasOnly)", async () => {
    const db = ctx("novo4", { emailVerificado: false }).firestore();
    await assertFails(setDoc(doc(db, "cadastrosPendentes", "novo4"), pendente("novo4", { role: "admin" })));
    await assertFails(setDoc(doc(db, "cadastrosPendentes", "novo4"), pendente("novo4", { status: "ativo" })));
  });

  it("dono não forja criadoPor (só Admin/Presidente convidando registram criadoPor)", async () => {
    const db = ctx("novo5", { emailVerificado: false }).firestore();
    await assertFails(setDoc(doc(db, "cadastrosPendentes", "novo5"), pendente("novo5", { criadoPor: "admin1" })));
  });

  it("e-mail fora do domínio institucional falha", async () => {
    const db = ctx("novo6", { email: "novo6@gmail.com", emailVerificado: false }).firestore();
    await assertFails(setDoc(doc(db, "cadastrosPendentes", "novo6"), pendente("novo6", { email: "novo6@gmail.com" })));
  });

  it("e-mail gravado diferente do e-mail da conta falha", async () => {
    const db = ctx("novo7", { emailVerificado: false }).firestore();
    await assertFails(setDoc(doc(db, "cadastrosPendentes", "novo7"), pendente("novo7", { email: "outra.pessoa@shinerio.com" })));
  });

  it("carga horária fora de 4/6/8 falha", async () => {
    const db = ctx("novo8", { emailVerificado: false }).firestore();
    await assertFails(setDoc(doc(db, "cadastrosPendentes", "novo8"), pendente("novo8", { cargaHoraria: 220 })));
  });

  it("foto acima do limite de tamanho falha", async () => {
    const db = ctx("novo9", { emailVerificado: false }).firestore();
    await assertFails(
      setDoc(doc(db, "cadastrosPendentes", "novo9"), pendente("novo9", { fotoBase64: "x".repeat(150001) }))
    );
  });

  it("colaborador comum NÃO cria cadastro pendente para terceiros", async () => {
    await seedUsuario("colabA", "colaborador");
    const db = ctx("colabA").firestore();
    await assertFails(setDoc(doc(db, "cadastrosPendentes", "terceiro"), pendente("terceiro", { criadoPor: "colabA" })));
  });

  it("DP/RH NÃO convidam colaboradores (só Admin/Presidente)", async () => {
    await seedUsuario("dp1", "dp");
    const db = ctx("dp1").firestore();
    await assertFails(setDoc(doc(db, "cadastrosPendentes", "terceiro"), pendente("terceiro", { criadoPor: "dp1" })));
  });

  it("Admin verificado cria o cadastro pendente de um convidado, registrando criadoPor", async () => {
    await seedUsuario("admin1", "admin");
    const db = ctx("admin1").firestore();
    await assertSucceeds(setDoc(doc(db, "cadastrosPendentes", "convidado1"), pendente("convidado1", { criadoPor: "admin1" })));
  });

  it("Admin NÃO registra criadoPor de outra pessoa (spoofing de autoria)", async () => {
    await seedUsuario("admin1", "admin");
    const db = ctx("admin1").firestore();
    await assertFails(setDoc(doc(db, "cadastrosPendentes", "convidado2"), pendente("convidado2", { criadoPor: "pres1" })));
  });

  it("Admin com e-mail NÃO confirmado não convida ninguém", async () => {
    await seedUsuario("admin1", "admin");
    const db = ctx("admin1", { emailVerificado: false }).firestore();
    await assertFails(setDoc(doc(db, "cadastrosPendentes", "convidado3"), pendente("convidado3", { criadoPor: "admin1" })));
  });

  it("dono verificado lê o próprio cadastro pendente (é assim que o 1º login o promove)", async () => {
    await seedPendente("colabL");
    const db = ctx("colabL").firestore();
    await assertSucceeds(getDoc(doc(db, "cadastrosPendentes", "colabL")));
  });

  it("dono com e-mail NÃO confirmado não lê o cadastro pendente", async () => {
    await seedPendente("colabM");
    const db = ctx("colabM", { emailVerificado: false }).firestore();
    await assertFails(getDoc(doc(db, "cadastrosPendentes", "colabM")));
  });

  it("BOLA: outro colaborador NÃO lê o cadastro pendente alheio", async () => {
    await seedUsuario("colabA", "colaborador");
    await seedPendente("colabN");
    const db = ctx("colabA").firestore();
    await assertFails(getDoc(doc(db, "cadastrosPendentes", "colabN")));
  });

  it("Admin lê o cadastro pendente de qualquer pessoa", async () => {
    await seedUsuario("admin1", "admin");
    await seedPendente("colabO");
    const db = ctx("admin1").firestore();
    await assertSucceeds(getDoc(doc(db, "cadastrosPendentes", "colabO")));
  });

  it("cadastro pendente é imutável (allow update: if false)", async () => {
    await seedPendente("colabP");
    const db = ctx("colabP").firestore();
    await assertFails(updateDoc(doc(db, "cadastrosPendentes", "colabP"), { nome: "Outro Nome" }));
  });

  it("dono verificado apaga o próprio cadastro pendente (limpeza após a promoção)", async () => {
    await seedPendente("colabQ");
    const db = ctx("colabQ").firestore();
    await assertSucceeds(deleteDoc(doc(db, "cadastrosPendentes", "colabQ")));
  });

  it("BOLA: colaborador NÃO apaga o cadastro pendente de outro", async () => {
    await seedUsuario("colabA", "colaborador");
    await seedPendente("colabR");
    const db = ctx("colabA").firestore();
    await assertFails(deleteDoc(doc(db, "cadastrosPendentes", "colabR")));
  });
});

// ---------------------------------------------------------------------------
// contratos/{id} — fila de aprovação (só Presidente escreve direto)
// ---------------------------------------------------------------------------
describe("contratos/{id}", () => {
  it("BOLA: colaborador NÃO lê contrato de outro colaborador", async () => {
    await seedUsuario("colabA", "colaborador");
    await semRegras((db) => setDoc(doc(db, "contratos", "c1"), { uid: "colabB", status: "ativo" }));
    const db = ctx("colabA").firestore();
    await assertFails(getDoc(doc(db, "contratos", "c1")));
  });

  it("colaborador lê o próprio contrato", async () => {
    await seedUsuario("colabA", "colaborador");
    await semRegras((db) => setDoc(doc(db, "contratos", "c1"), { uid: "colabA", status: "ativo" }));
    const db = ctx("colabA").firestore();
    await assertSucceeds(getDoc(doc(db, "contratos", "c1")));
  });

  it("admin NÃO escreve direto em contratos (deve passar pela fila de solicitações)", async () => {
    await seedUsuario("admin1", "admin");
    const db = ctx("admin1").firestore();
    await assertFails(setDoc(doc(db, "contratos", "c2"), { uid: "colabA", status: "ativo" }));
  });

  it("presidente escreve direto em contratos", async () => {
    await seedUsuario("pres1", "presidente");
    const db = ctx("pres1").firestore();
    await assertSucceeds(setDoc(doc(db, "contratos", "c3"), { uid: "colabA", status: "ativo" }));
  });
});

// ---------------------------------------------------------------------------
// contratosEmpresariais/{id}
// ---------------------------------------------------------------------------
describe("contratosEmpresariais/{id}", () => {
  it("RH lê contratos empresariais", async () => {
    await seedUsuario("rh1", "rh");
    await semRegras((db) => setDoc(doc(db, "contratosEmpresariais", "ce1"), { cnpj: "123", status: "ativo" }));
    const db = ctx("rh1").firestore();
    await assertSucceeds(getDoc(doc(db, "contratosEmpresariais", "ce1")));
  });

  it("colaborador comum NÃO lê contratos empresariais", async () => {
    await seedUsuario("colabA", "colaborador");
    await semRegras((db) => setDoc(doc(db, "contratosEmpresariais", "ce1"), { cnpj: "123", status: "ativo" }));
    const db = ctx("colabA").firestore();
    await assertFails(getDoc(doc(db, "contratosEmpresariais", "ce1")));
  });

  it("admin NÃO escreve direto (só Presidente, mesma fila da seção acima)", async () => {
    await seedUsuario("admin1", "admin");
    const db = ctx("admin1").firestore();
    await assertFails(setDoc(doc(db, "contratosEmpresariais", "ce2"), { cnpj: "999", status: "ativo" }));
  });
});

// ---------------------------------------------------------------------------
// faltas / atrasos / advertencias — mesmo padrão de leitura; escrita restrita a ehDp()
// ---------------------------------------------------------------------------
for (const colecao of ["faltas", "atrasos", "advertencias"]) {
  describe(`${colecao}/{id}`, () => {
    it(`BOLA: colaborador NÃO lê ${colecao} de outro colaborador`, async () => {
      await seedUsuario("colabA", "colaborador");
      await semRegras((db) => setDoc(doc(db, colecao, "x1"), { uid: "colabB", motivo: "teste" }));
      const db = ctx("colabA").firestore();
      await assertFails(getDoc(doc(db, colecao, "x1")));
    });

    it(`colaborador lê os próprios registros de ${colecao}`, async () => {
      await seedUsuario("colabA", "colaborador");
      await semRegras((db) => setDoc(doc(db, colecao, "x2"), { uid: "colabA", motivo: "teste" }));
      const db = ctx("colabA").firestore();
      await assertSucceeds(getDoc(doc(db, colecao, "x2")));
    });

    it(`RH sozinho NÃO cria lançamento em ${colecao} (só DP/Admin/Presidente)`, async () => {
      await seedUsuario("rh1", "rh");
      const db = ctx("rh1").firestore();
      await assertFails(setDoc(doc(db, colecao, "x3"), { uid: "colabA", motivo: "teste" }));
    });

    it(`DP cria lançamento em ${colecao}`, async () => {
      await seedUsuario("dp1", "dp");
      const db = ctx("dp1").firestore();
      await assertSucceeds(setDoc(doc(db, colecao, "x4"), { uid: "colabA", motivo: "teste" }));
    });
  });
}

// ---------------------------------------------------------------------------
// avaliacoes/{id}
// ---------------------------------------------------------------------------
describe("avaliacoes/{id}", () => {
  it("DP sozinho NÃO cria avaliação direto (deve passar pela fila do Presidente)", async () => {
    await seedUsuario("dp1", "dp");
    const db = ctx("dp1").firestore();
    await assertFails(setDoc(doc(db, "avaliacoes", "a1"), { uid: "colabA", nota: 9 }));
  });

  it("presidente cria avaliação direto", async () => {
    await seedUsuario("pres1", "presidente");
    const db = ctx("pres1").firestore();
    await assertSucceeds(setDoc(doc(db, "avaliacoes", "a2"), { uid: "colabA", nota: 9 }));
  });

  it("RH pode apagar uma avaliação lançada por engano", async () => {
    await seedUsuario("rh1", "rh");
    await semRegras((db) => setDoc(doc(db, "avaliacoes", "a3"), { uid: "colabA", nota: 9 }));
    const db = ctx("rh1").firestore();
    await assertSucceeds(deleteDoc(doc(db, "avaliacoes", "a3")));
  });
});

// ---------------------------------------------------------------------------
// solicitacoes/{id} — fila de aprovação do Presidente
// ---------------------------------------------------------------------------
describe("solicitacoes/{id}", () => {
  it("DP cria solicitação pendente em nome de si mesmo", async () => {
    await seedUsuario("dp1", "dp");
    const db = ctx("dp1").firestore();
    await assertSucceeds(
      setDoc(doc(db, "solicitacoes", "s1"), { status: "pendente", solicitadoPorUid: "dp1", tipo: "contrato" })
    );
  });

  it("mass assignment/spoofing: DP NÃO cria solicitação em nome de outra pessoa", async () => {
    await seedUsuario("dp1", "dp");
    const db = ctx("dp1").firestore();
    await assertFails(
      setDoc(doc(db, "solicitacoes", "s2"), { status: "pendente", solicitadoPorUid: "outraPessoa", tipo: "contrato" })
    );
  });

  it("BOLA: DP não lê solicitação de outro solicitante (só a própria ou sendo Presidente)", async () => {
    await seedUsuario("dp1", "dp");
    await seedUsuario("dp2", "dp");
    await semRegras((db) =>
      setDoc(doc(db, "solicitacoes", "s3"), { status: "pendente", solicitadoPorUid: "dp2", tipo: "contrato" })
    );
    const db = ctx("dp1").firestore();
    await assertFails(getDoc(doc(db, "solicitacoes", "s3")));
  });

  it("admin NÃO resolve (aceitar/rejeitar) solicitações — só o Presidente", async () => {
    await seedUsuario("admin1", "admin");
    await semRegras((db) =>
      setDoc(doc(db, "solicitacoes", "s4"), { status: "pendente", solicitadoPorUid: "dp1", tipo: "contrato" })
    );
    const db = ctx("admin1").firestore();
    await assertFails(updateDoc(doc(db, "solicitacoes", "s4"), { status: "aceita" }));
  });

  it("presidente resolve uma solicitação pendente", async () => {
    await seedUsuario("pres1", "presidente");
    await semRegras((db) =>
      setDoc(doc(db, "solicitacoes", "s5"), { status: "pendente", solicitadoPorUid: "dp1", tipo: "contrato" })
    );
    const db = ctx("pres1").firestore();
    await assertSucceeds(updateDoc(doc(db, "solicitacoes", "s5"), { status: "aceita" }));
  });

  it("presidente NÃO reabre/edita uma solicitação já resolvida (imutabilidade pós-decisão)", async () => {
    await seedUsuario("pres1", "presidente");
    await semRegras((db) =>
      setDoc(doc(db, "solicitacoes", "s6"), { status: "aceita", solicitadoPorUid: "dp1", tipo: "contrato" })
    );
    const db = ctx("pres1").firestore();
    await assertFails(updateDoc(doc(db, "solicitacoes", "s6"), { status: "rejeitada" }));
  });

  it("ninguém apaga uma solicitação (allow delete: if false)", async () => {
    await seedUsuario("pres1", "presidente");
    await semRegras((db) =>
      setDoc(doc(db, "solicitacoes", "s7"), { status: "pendente", solicitadoPorUid: "dp1", tipo: "contrato" })
    );
    const db = ctx("pres1").firestore();
    await assertFails(deleteDoc(doc(db, "solicitacoes", "s7")));
  });
});

// ---------------------------------------------------------------------------
// fundo/{ano} e estatisticas/publico — dados agregados
// ---------------------------------------------------------------------------
describe("fundo/{ano} e estatisticas/publico", () => {
  it("colaborador autenticado e verificado lê fundo/{ano}", async () => {
    await seedUsuario("colabA", "colaborador");
    await semRegras((db) => setDoc(doc(db, "fundo", "2026"), { saldo: 1000 }));
    const db = ctx("colabA").firestore();
    await assertSucceeds(getDoc(doc(db, "fundo", "2026")));
  });

  it("e-mail não verificado NÃO lê fundo/{ano} (segunda barreira além do redirect da UI)", async () => {
    await seedUsuario("colabA", "colaborador");
    await semRegras((db) => setDoc(doc(db, "fundo", "2026"), { saldo: 1000 }));
    const db = ctx("colabA", { emailVerificado: false }).firestore();
    await assertFails(getDoc(doc(db, "fundo", "2026")));
  });

  it("colaborador NÃO escreve em fundo/{ano} (só DP/RH/Admin/Presidente)", async () => {
    await seedUsuario("colabA", "colaborador");
    const db = ctx("colabA").firestore();
    await assertFails(setDoc(doc(db, "fundo", "2026"), { saldo: 2000 }));
  });

  it("estatisticas/publico é lido sem autenticação (landing page)", async () => {
    await semRegras((db) => setDoc(doc(db, "estatisticas", "publico"), { arrecadado: 1000, colaboradores: 50 }));
    const db = anon().firestore();
    await assertSucceeds(getDoc(doc(db, "estatisticas", "publico")));
  });

  it("visitante anônimo NÃO escreve em estatisticas/publico", async () => {
    const db = anon().firestore();
    await assertFails(setDoc(doc(db, "estatisticas", "publico"), { arrecadado: 999999, colaboradores: 1 }));
  });
});

// ---------------------------------------------------------------------------
// logs/{id} — trilha de auditoria imutável
// ---------------------------------------------------------------------------
describe("logs/{id}", () => {
  it("DP cria entrada de log", async () => {
    await seedUsuario("dp1", "dp");
    const db = ctx("dp1").firestore();
    await assertSucceeds(setDoc(doc(db, "logs", "l1"), { acao: "lancou-falta", uid: "colabA" }));
  });

  it("DP NÃO lê a trilha de logs (só Admin/Presidente)", async () => {
    await seedUsuario("dp1", "dp");
    await semRegras((db) => setDoc(doc(db, "logs", "l2"), { acao: "lancou-falta", uid: "colabA" }));
    const db = ctx("dp1").firestore();
    await assertFails(getDoc(doc(db, "logs", "l2")));
  });

  it("ninguém edita um log existente, nem Admin (falsificaria a trilha)", async () => {
    await seedUsuario("admin1", "admin");
    await semRegras((db) => setDoc(doc(db, "logs", "l3"), { acao: "lancou-falta", uid: "colabA" }));
    const db = ctx("admin1").firestore();
    await assertFails(updateDoc(doc(db, "logs", "l3"), { acao: "editado" }));
  });

  it("admin apaga um log", async () => {
    await seedUsuario("admin1", "admin");
    await semRegras((db) => setDoc(doc(db, "logs", "l4"), { acao: "lancou-falta", uid: "colabA" }));
    const db = ctx("admin1").firestore();
    await assertSucceeds(deleteDoc(doc(db, "logs", "l4")));
  });
});

// ---------------------------------------------------------------------------
// Avaliação de Conduta (entre colegas) — feature social/anônima, separada de avaliacoes/{id}.
// ---------------------------------------------------------------------------

/** Liga o interruptor global direto (ignorando regras) — a maioria dos testes de voto/contagem
 * precisa da função já ativa para chegar a testar a regra que realmente querem exercitar. */
async function ativarConduta() {
  await semRegras((db) => setDoc(doc(db, "configuracoes", "avaliacaoConduta"), { ativo: true }));
}

describe("configuracoes/avaliacaoConduta", () => {
  it("colaborador lê a flag mesmo desligada (sem doc = tratado como desligada pelo app)", async () => {
    await seedUsuario("colabA", "colaborador");
    const db = ctx("colabA").firestore();
    await assertSucceeds(getDoc(doc(db, "configuracoes", "avaliacaoConduta")));
  });

  it("colaborador NÃO liga a função", async () => {
    await seedUsuario("colabA", "colaborador");
    const db = ctx("colabA").firestore();
    await assertFails(setDoc(doc(db, "configuracoes", "avaliacaoConduta"), { ativo: true }));
  });

  it("admin liga a função", async () => {
    await seedUsuario("admin1", "admin");
    const db = ctx("admin1").firestore();
    await assertSucceeds(setDoc(doc(db, "configuracoes", "avaliacaoConduta"), { ativo: true }));
  });

  it("presidente liga a função", async () => {
    await seedUsuario("pres1", "presidente");
    const db = ctx("pres1").firestore();
    await assertSucceeds(setDoc(doc(db, "configuracoes", "avaliacaoConduta"), { ativo: true }));
  });

  it("DP/RH NÃO ligam a função", async () => {
    await seedUsuario("dp1", "dp");
    const db = ctx("dp1").firestore();
    await assertFails(setDoc(doc(db, "configuracoes", "avaliacaoConduta"), { ativo: true }));
  });
});

describe("diretorioPublico/{uid}", () => {
  it("colaborador sincroniza a própria entrada", async () => {
    await seedUsuario("colabA", "colaborador", { nome: "colabA", cargo: "Operações" });
    const db = ctx("colabA").firestore();
    await assertSucceeds(setDoc(doc(db, "diretorioPublico", "colabA"), {
      nome: "colabA", cargo: "Operações", role: "colaborador"
    }));
  });

  it("BOLA: colaborador comum NÃO grava a entrada de outro uid", async () => {
    await seedUsuario("colabA", "colaborador", { nome: "colabA", cargo: "Operações" });
    await seedUsuario("colabB", "colaborador", { nome: "colabB", cargo: "Financeiro" });
    const db = ctx("colabA").firestore();
    await assertFails(setDoc(doc(db, "diretorioPublico", "colabB"), {
      nome: "colabB", cargo: "Financeiro", role: "colaborador"
    }));
  });

  it("admin sincroniza a entrada de outro colaborador (criar/editar pelo painel de gestão)", async () => {
    await seedUsuario("admin1", "admin");
    await seedUsuario("colabB", "colaborador", { nome: "colabB", cargo: "Financeiro" });
    const db = ctx("admin1").firestore();
    await assertSucceeds(setDoc(doc(db, "diretorioPublico", "colabB"), {
      nome: "colabB", cargo: "Financeiro", role: "colaborador"
    }));
  });

  it("DP/RH NÃO sincronizam a entrada de outro colaborador (só Admin/Presidente)", async () => {
    await seedUsuario("dp1", "dp");
    await seedUsuario("colabB", "colaborador", { nome: "colabB", cargo: "Financeiro" });
    const db = ctx("dp1").firestore();
    await assertFails(setDoc(doc(db, "diretorioPublico", "colabB"), {
      nome: "colabB", cargo: "Financeiro", role: "colaborador"
    }));
  });

  it("mass assignment: campo extra não previsto falha (hasOnly)", async () => {
    await seedUsuario("colabA", "colaborador", { nome: "colabA", cargo: "Operações" });
    const db = ctx("colabA").firestore();
    await assertFails(setDoc(doc(db, "diretorioPublico", "colabA"), {
      nome: "colabA", cargo: "Operações", role: "colaborador", email: "vazamento@shinerio.com"
    }));
  });

  it("spoofing: nome/cargo/role divergentes do usuarios/{uid} real falham", async () => {
    await seedUsuario("colabA", "colaborador", { nome: "colabA", cargo: "Operações" });
    const db = ctx("colabA").firestore();
    await assertFails(setDoc(doc(db, "diretorioPublico", "colabA"), {
      nome: "Nome Falso", cargo: "Operações", role: "colaborador"
    }));
  });

  it("presidente NÃO cria a própria entrada (não participa da função)", async () => {
    await seedUsuario("pres1", "presidente", { nome: "pres1", cargo: "Diretoria" });
    const db = ctx("pres1").firestore();
    await assertFails(setDoc(doc(db, "diretorioPublico", "pres1"), {
      nome: "pres1", cargo: "Diretoria", role: "presidente"
    }));
  });

  it("admin também NÃO consegue criar entrada para o Presidente", async () => {
    await seedUsuario("admin1", "admin");
    await seedUsuario("pres1", "presidente", { nome: "pres1", cargo: "Diretoria" });
    const db = ctx("admin1").firestore();
    await assertFails(setDoc(doc(db, "diretorioPublico", "pres1"), {
      nome: "pres1", cargo: "Diretoria", role: "presidente"
    }));
  });

  it("qualquer usuário verificado lê o diretório inteiro", async () => {
    await seedUsuario("colabA", "colaborador");
    await seedUsuario("colabB", "colaborador");
    await semRegras((db) => setDoc(doc(db, "diretorioPublico", "colabB"), {
      nome: "colabB", cargo: "Financeiro", role: "colaborador"
    }));
    const db = ctx("colabA").firestore();
    await assertSucceeds(getDocs(collection(db, "diretorioPublico")));
  });
});

describe("votosConduta/{votoId}", () => {
  it("colaborador vota num colega com a função ativa", async () => {
    await ativarConduta();
    await seedUsuario("colabA", "colaborador");
    await seedUsuario("colabB", "colaborador");
    const db = ctx("colabA").firestore();
    await assertSucceeds(setDoc(doc(db, "votosConduta", "colabA_colabB"), {
      avaliadorUid: "colabA", avaliadoUid: "colabB", conceito: "excelente",
      criadoEm: "placeholder", atualizadoEm: "placeholder"
    }));
  });

  it("voto falha com a função desligada", async () => {
    await seedUsuario("colabA", "colaborador");
    await seedUsuario("colabB", "colaborador");
    const db = ctx("colabA").firestore();
    await assertFails(setDoc(doc(db, "votosConduta", "colabA_colabB"), {
      avaliadorUid: "colabA", avaliadoUid: "colabB", conceito: "excelente",
      criadoEm: "placeholder", atualizadoEm: "placeholder"
    }));
  });

  it("autovoto falha", async () => {
    await ativarConduta();
    await seedUsuario("colabA", "colaborador");
    const db = ctx("colabA").firestore();
    await assertFails(setDoc(doc(db, "votosConduta", "colabA_colabA"), {
      avaliadorUid: "colabA", avaliadoUid: "colabA", conceito: "excelente",
      criadoEm: "placeholder", atualizadoEm: "placeholder"
    }));
  });

  it("votar num uid de Presidente falha", async () => {
    await ativarConduta();
    await seedUsuario("colabA", "colaborador");
    await seedUsuario("pres1", "presidente");
    const db = ctx("colabA").firestore();
    await assertFails(setDoc(doc(db, "votosConduta", "colabA_pres1"), {
      avaliadorUid: "colabA", avaliadoUid: "pres1", conceito: "excelente",
      criadoEm: "placeholder", atualizadoEm: "placeholder"
    }));
  });

  it("presidente votando falha (não participa)", async () => {
    await ativarConduta();
    await seedUsuario("pres1", "presidente");
    await seedUsuario("colabA", "colaborador");
    const db = ctx("pres1").firestore();
    await assertFails(setDoc(doc(db, "votosConduta", "pres1_colabA"), {
      avaliadorUid: "pres1", avaliadoUid: "colabA", conceito: "excelente",
      criadoEm: "placeholder", atualizadoEm: "placeholder"
    }));
  });

  it("id do documento que não bate com avaliadorUid_avaliadoUid falha", async () => {
    await ativarConduta();
    await seedUsuario("colabA", "colaborador");
    await seedUsuario("colabB", "colaborador");
    const db = ctx("colabA").firestore();
    await assertFails(setDoc(doc(db, "votosConduta", "id-qualquer"), {
      avaliadorUid: "colabA", avaliadoUid: "colabB", conceito: "excelente",
      criadoEm: "placeholder", atualizadoEm: "placeholder"
    }));
  });

  it("BOLA: o avaliado NÃO lê o voto que recebeu (anonimato)", async () => {
    await ativarConduta();
    await seedUsuario("colabA", "colaborador");
    await seedUsuario("colabB", "colaborador");
    await semRegras((db) => setDoc(doc(db, "votosConduta", "colabA_colabB"), {
      avaliadorUid: "colabA", avaliadoUid: "colabB", conceito: "excelente"
    }));
    const db = ctx("colabB").firestore();
    await assertFails(getDoc(doc(db, "votosConduta", "colabA_colabB")));
  });

  it("o autor lê o próprio voto", async () => {
    await ativarConduta();
    await seedUsuario("colabA", "colaborador");
    await seedUsuario("colabB", "colaborador");
    await semRegras((db) => setDoc(doc(db, "votosConduta", "colabA_colabB"), {
      avaliadorUid: "colabA", avaliadoUid: "colabB", conceito: "excelente"
    }));
    const db = ctx("colabA").firestore();
    await assertSucceeds(getDoc(doc(db, "votosConduta", "colabA_colabB")));
  });

  it("ler o próprio voto ANTES de existir também é permitido (necessário pro tx.get() do primeiro voto)", async () => {
    await ativarConduta();
    await seedUsuario("colabA", "colaborador");
    await seedUsuario("colabB", "colaborador");
    const db = ctx("colabA").firestore();
    await assertSucceeds(getDoc(doc(db, "votosConduta", "colabA_colabB")));
  });

  it("ninguém apaga um voto (allow delete: if false)", async () => {
    await ativarConduta();
    await seedUsuario("colabA", "colaborador");
    await seedUsuario("colabB", "colaborador");
    await semRegras((db) => setDoc(doc(db, "votosConduta", "colabA_colabB"), {
      avaliadorUid: "colabA", avaliadoUid: "colabB", conceito: "excelente"
    }));
    const db = ctx("colabA").firestore();
    await assertFails(deleteDoc(doc(db, "votosConduta", "colabA_colabB")));
  });
});

describe("condutaContagem/{avaliadoUid}", () => {
  it("primeiro voto cria a contagem com soma 1", async () => {
    await ativarConduta();
    await seedUsuario("colabA", "colaborador");
    await seedUsuario("colabB", "colaborador");
    const db = ctx("colabA").firestore();
    await assertSucceeds(setDoc(doc(db, "condutaContagem", "colabB"), {
      excelente: 1, bom: 0, regular: 0, insatisfatorio: 0, atualizadoEm: "placeholder"
    }));
  });

  it("tentar semear a contagem já nascendo com soma > 1 falha", async () => {
    await ativarConduta();
    await seedUsuario("colabA", "colaborador");
    await seedUsuario("colabB", "colaborador");
    const db = ctx("colabA").firestore();
    await assertFails(setDoc(doc(db, "condutaContagem", "colabB"), {
      excelente: 5, bom: 0, regular: 0, insatisfatorio: 0, atualizadoEm: "placeholder"
    }));
  });

  it("trocar de conceito (-1/+1) é aceito", async () => {
    await ativarConduta();
    await seedUsuario("colabA", "colaborador");
    await seedUsuario("colabB", "colaborador");
    await semRegras((db) => setDoc(doc(db, "condutaContagem", "colabB"), { excelente: 0, bom: 1, regular: 0, insatisfatorio: 0 }));
    const db = ctx("colabA").firestore();
    await assertSucceeds(setDoc(doc(db, "condutaContagem", "colabB"), {
      excelente: 1, bom: 0, regular: 0, insatisfatorio: 0, atualizadoEm: "placeholder"
    }));
  });

  it("pular +5 num campo numa única escrita falha (bounding)", async () => {
    await ativarConduta();
    await seedUsuario("colabA", "colaborador");
    await seedUsuario("colabB", "colaborador");
    await semRegras((db) => setDoc(doc(db, "condutaContagem", "colabB"), { excelente: 0, bom: 0, regular: 0, insatisfatorio: 0 }));
    const db = ctx("colabA").firestore();
    await assertFails(setDoc(doc(db, "condutaContagem", "colabB"), {
      excelente: 5, bom: 0, regular: 0, insatisfatorio: 0, atualizadoEm: "placeholder"
    }));
  });

  it("reduzir a soma total falha", async () => {
    await ativarConduta();
    await seedUsuario("colabA", "colaborador");
    await seedUsuario("colabB", "colaborador");
    await semRegras((db) => setDoc(doc(db, "condutaContagem", "colabB"), { excelente: 1, bom: 0, regular: 0, insatisfatorio: 0 }));
    const db = ctx("colabA").firestore();
    await assertFails(setDoc(doc(db, "condutaContagem", "colabB"), {
      excelente: 0, bom: 0, regular: 0, insatisfatorio: 0, atualizadoEm: "placeholder"
    }));
  });

  it("o avaliado lê a própria contagem", async () => {
    await seedUsuario("colabB", "colaborador");
    await semRegras((db) => setDoc(doc(db, "condutaContagem", "colabB"), { excelente: 1, bom: 0, regular: 0, insatisfatorio: 0 }));
    const db = ctx("colabB").firestore();
    await assertSucceeds(getDoc(doc(db, "condutaContagem", "colabB")));
  });

  it("BOLA: colaborador qualquer NÃO lê a contagem de outro colaborador", async () => {
    await seedUsuario("colabA", "colaborador");
    await seedUsuario("colabB", "colaborador");
    await semRegras((db) => setDoc(doc(db, "condutaContagem", "colabB"), { excelente: 1, bom: 0, regular: 0, insatisfatorio: 0 }));
    const db = ctx("colabA").firestore();
    await assertFails(getDoc(doc(db, "condutaContagem", "colabB")));
  });

  it("DP/RH/Admin/Presidente leem a contagem de qualquer colaborador (mesmo escopo de ver perfil)", async () => {
    await seedUsuario("rh1", "rh");
    await seedUsuario("colabB", "colaborador");
    await semRegras((db) => setDoc(doc(db, "condutaContagem", "colabB"), { excelente: 1, bom: 0, regular: 0, insatisfatorio: 0 }));
    const db = ctx("rh1").firestore();
    await assertSucceeds(getDoc(doc(db, "condutaContagem", "colabB")));
  });
});
