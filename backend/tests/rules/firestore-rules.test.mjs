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
import {
  doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, collection,
  writeBatch, runTransaction, increment, serverTimestamp, Timestamp, query, where
} from "firebase/firestore";

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

// `cargaHoraria: 8` e `dataAdmissao` presentes: antes a fixture usava 220 (valor que o schema
// real nunca aceita — ver `cargaHoraria in [4,6,8]` em cadastroPendenteValido) e omitia
// dataAdmissao. Isso passava porque as regras só checavam PAPEL, nunca VALOR. Agora que
// valoresPerfilValidos() vale para todo update, a fixture precisa refletir um perfil de verdade,
// igual ao que backend/scripts/seed-usuarios.js grava em produção.
// `nome` com duas palavras: diretorioPublico valida `primeiroNome == nome.split(' ')[0]`.
async function seedUsuario(uid, role, extra = {}) {
  await semRegras((db) =>
    setDoc(doc(db, "usuarios", uid), {
      nome: `Pessoa ${uid}`,
      email: `${uid}${DOMINIO}`,
      cargo: "Operações",
      cargaHoraria: 8,
      dataAdmissao: "2026-01-05",
      status: "ativo",
      motivoPerdaIntegral: null,
      role,
      ...extra
    })
  );
}

/* ------------------------------------------------------------------ */
/* Payloads válidos conforme o schema das regras.                     */
/*                                                                     */
/* Antes cada teste montava um objeto mínimo e inventado ({uid, nota: 9} */
/* para uma avaliação, p.ex. — `nota` nem é um campo que o app grava).  */
/* Funcionava porque nenhuma regra validava o conteúdo. Com o schema    */
/* fechado, os testes de caminho feliz têm de enviar o documento real   */
/* que gestao.js envia — o que também faz o teste provar mais.          */
/* ------------------------------------------------------------------ */
function novaFalta(operadorUid, alvoUid, extra = {}) {
  return { uid: alvoUid, data: "2026-03-10", justificada: false, tipoJustificativa: null,
           motivo: "teste", registradoPor: operadorUid, ...extra };
}
function novoAtraso(operadorUid, alvoUid, extra = {}) {
  return { uid: alvoUid, mesAno: "2026-03", quantidadeAtrasos: 2,
           registradoPor: operadorUid, ...extra };
}
function novaAdvertencia(operadorUid, alvoUid, extra = {}) {
  return { uid: alvoUid, data: "2026-03-10", tipo: "verbal", motivo: "teste",
           registradoPor: operadorUid, ...extra };
}
/** Escolhe o payload certo para o loop faltas/atrasos/advertencias. */
function novoLancamento(colecao, operadorUid, alvoUid, extra = {}) {
  return colecao === "atrasos" ? novoAtraso(operadorUid, alvoUid, extra)
       : colecao === "advertencias" ? novaAdvertencia(operadorUid, alvoUid, extra)
       : novaFalta(operadorUid, alvoUid, extra);
}
function novaAvaliacao(operadorUid, alvoUid, extra = {}) {
  return { uid: alvoUid, data: "2026-03-10", ano: 2026, conceito: "bom",
           justificativa: "teste", validadoRH: true, avaliadoPor: operadorUid, ...extra };
}
function novoContrato(operadorUid, alvoUid, extra = {}) {
  return { uid: alvoUid, dataAtivacao: "2026-02-01", dataEncerramento: null,
           valorCredito: 150, status: "ativo", registradoPor: operadorUid, ...extra };
}
function novaSolicitacao(operadorUid, alvoUid, extra = {}) {
  return {
    tipo: "alterar_status_colaborador",
    descricao: "Status alterado para Afastado",
    alvoUid, alvoNome: "Pessoa alvo",
    dadosAcao: { uid: alvoUid, campos: { status: "afastado", dataDesligamento: "2026-03-10" } },
    status: "pendente",
    solicitadoPorUid: operadorUid,
    solicitadoPorNome: "Operador",
    ...extra
  };
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

  // O perfil só pode ser cópia do cadastro pendente — sem isso, depois de confirmar o e-mail a
  // pessoa gravaria qualquer valor em campos que alimentam elegibilidade/peso no Fundo.
  for (const [campo, valor] of Object.entries({
    cargaHoraria: 999,
    dataAdmissao: "1990-01-01",
    nome: "Outro Nome",
    cargo: "Diretoria",
    status: "desligado",
    motivoPerdaIntegral: "qualquer",
    dataDesligamento: "2026-02-02",
    fotoBase64: "data:image/jpeg;base64,AAAA"
  })) {
    it(`promoção NÃO aceita ${campo} diferente do cadastro pendente`, async () => {
      await seedPendente("colabV");
      const db = ctx("colabV").firestore();
      await assertFails(setDoc(doc(db, "usuarios", "colabV"), perfilPromovido("colabV", { [campo]: valor })));
    });
  }

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

  it("ex-colaborador (conta já verificada, perfil excluído pelo Admin) NÃO recria o próprio cadastro para se re-promover", async () => {
    const db = ctx("exColab").firestore(); // verificado
    await assertFails(setDoc(doc(db, "cadastrosPendentes", "exColab"), pendente("exColab")));
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
// contratos/{id} — ativação/encerramento individual (dado interno de RH; RH/Admin/Presidente gravam direto)
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

  it("admin grava direto em contratos (dado interno de RH — não passa pela fila de solicitações)", async () => {
    await seedUsuario("admin1", "admin");
    await seedUsuario("colabA", "colaborador");
    const db = ctx("admin1").firestore();
    await assertSucceeds(setDoc(doc(db, "contratos", "c2"), novoContrato("admin1", "colabA")));
  });

  it("RH grava direto em contratos", async () => {
    await seedUsuario("rh1", "rh");
    await seedUsuario("colabA", "colaborador");
    const db = ctx("rh1").firestore();
    await assertSucceeds(setDoc(doc(db, "contratos", "c2b"), novoContrato("rh1", "colabA")));
  });

  it("DP e colaborador comum NÃO gravam em contratos", async () => {
    await seedUsuario("dp1", "dp");
    await seedUsuario("colabA", "colaborador");
    await assertFails(setDoc(doc(ctx("dp1").firestore(), "contratos", "c2c"), novoContrato("dp1", "colabA")));
    await assertFails(setDoc(doc(ctx("colabA").firestore(), "contratos", "c2d"), novoContrato("colabA", "colabA")));
  });

  it("presidente escreve direto em contratos", async () => {
    await seedUsuario("pres1", "presidente");
    await seedUsuario("colabA", "colaborador");
    const db = ctx("pres1").firestore();
    await assertSucceeds(setDoc(doc(db, "contratos", "c3"), novoContrato("pres1", "colabA")));
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
    await assertFails(setDoc(doc(db, "contratosEmpresariais", "ce2"), novoContratoEmpresarial("admin1")));
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
      await seedUsuario("colabA", "colaborador");
      const db = ctx("rh1").firestore();
      await assertFails(setDoc(doc(db, colecao, "x3"), novoLancamento(colecao, "rh1", "colabA")));
    });

    it(`DP cria lançamento em ${colecao}`, async () => {
      await seedUsuario("dp1", "dp");
      await seedUsuario("colabA", "colaborador");
      const db = ctx("dp1").firestore();
      await assertSucceeds(setDoc(doc(db, colecao, "x4"), novoLancamento(colecao, "dp1", "colabA")));
    });
  });
}

// ---------------------------------------------------------------------------
// avaliacoes/{id}
// ---------------------------------------------------------------------------
describe("avaliacoes/{id}", () => {
  it("DP sozinho NÃO cria avaliação direto (deve passar pela fila do Presidente)", async () => {
    await seedUsuario("dp1", "dp");
    await seedUsuario("colabA", "colaborador");
    const db = ctx("dp1").firestore();
    await assertFails(setDoc(doc(db, "avaliacoes", "a1"), novaAvaliacao("dp1", "colabA")));
  });

  it("presidente cria avaliação direto", async () => {
    await seedUsuario("pres1", "presidente");
    await seedUsuario("colabA", "colaborador");
    const db = ctx("pres1").firestore();
    await assertSucceeds(setDoc(doc(db, "avaliacoes", "a2"), novaAvaliacao("pres1", "colabA")));
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
      setDoc(doc(db, "solicitacoes", "s1"), novaSolicitacao("dp1", "colabA"))
    );
  });

  it("mass assignment/spoofing: DP NÃO cria solicitação em nome de outra pessoa", async () => {
    await seedUsuario("dp1", "dp");
    const db = ctx("dp1").firestore();
    await assertFails(
      setDoc(doc(db, "solicitacoes", "s2"), novaSolicitacao("outraPessoa", "colabA"))
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
      setDoc(doc(db, "solicitacoes", "s5"), { status: "pendente", solicitadoPorUid: "dp1", tipo: "avaliacao" })
    );
    const db = ctx("pres1").firestore();
    // resolvidoPorUid passou a ser obrigatório e fixado em request.auth.uid — é o que torna a
    // decisão da fila atribuível a quem de fato decidiu.
    await assertSucceeds(updateDoc(doc(db, "solicitacoes", "s5"), {
      status: "aceita", resolvidoPorUid: "pres1", resolvidoEm: "placeholder"
    }));
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
    await assertFails(setDoc(doc(db, "fundo", "2026"), novoFundo("colabA")));
  });

  it("estatisticas/publico é lido sem autenticação (landing page)", async () => {
    await semRegras((db) => setDoc(doc(db, "estatisticas", "publico"), { arrecadado: 1000, colaboradores: 50 }));
    const db = anon().firestore();
    await assertSucceeds(getDoc(doc(db, "estatisticas", "publico")));
  });

  it("visitante anônimo NÃO escreve em estatisticas/publico", async () => {
    const db = anon().firestore();
    await assertFails(setDoc(doc(db, "estatisticas", "publico"), { arrecadado: 999999, colaboradores: 1, atualizadoEm: serverTimestamp() }));
  });
});

// ---------------------------------------------------------------------------
// logs/{id} — trilha de auditoria imutável
// ---------------------------------------------------------------------------
describe("logs/{id}", () => {
  /** Entrada que registrarLog() (gestao.js) grava. */
  function novoLog(operadorUid, extra = {}) {
    return { tipo: "falta", descricao: "Falta injustificada lançada em 2026-03-10", alvoUid: "colabA",
             alvoNome: "Pessoa colabA", operadorUid, operadorNome: "Operador", ...extra };
  }

  it("DP cria entrada de log", async () => {
    await seedUsuario("dp1", "dp");
    const db = ctx("dp1").firestore();
    await assertSucceeds(setDoc(doc(db, "logs", "l1"), novoLog("dp1")));
  });

  it("spoofing: DP NÃO grava uma entrada atribuída a outro gestor", async () => {
    await seedUsuario("dp1", "dp");
    const db = ctx("dp1").firestore();
    await assertFails(setDoc(doc(db, "logs", "l1b"), novoLog("admin1")));
  });

  it("mass assignment: entrada de log com campo fora do schema falha", async () => {
    await seedUsuario("dp1", "dp");
    const db = ctx("dp1").firestore();
    await assertFails(setDoc(doc(db, "logs", "l1c"), novoLog("dp1", { campoExtra: "x" })));
  });

  it("Admin desligado NÃO lê nem apaga a trilha", async () => {
    await seedUsuario("admin1", "admin", { status: "demitido", motivoPerdaIntegral: "demitido" });
    await semRegras((db) => setDoc(doc(db, "logs", "l5"), novoLog("dp1")));
    const db = ctx("admin1").firestore();
    await assertFails(getDoc(doc(db, "logs", "l5")));
    await assertFails(deleteDoc(doc(db, "logs", "l5")));
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

describe("diretorioPublico/{uid}", () => {
  it("colaborador sincroniza a própria entrada", async () => {
    await seedUsuario("colabA", "colaborador", { nome: "Ana Souza", cargo: "Operações" });
    const db = ctx("colabA").firestore();
    await assertSucceeds(setDoc(doc(db, "diretorioPublico", "colabA"), {
      primeiroNome: "Ana", cargo: "Operações", role: "colaborador"
    }));
  });

  it("minimização: o diretório NÃO aceita o nome completo, só o primeiro nome", async () => {
    await seedUsuario("colabA", "colaborador", { nome: "Ana Souza", cargo: "Operações" });
    const db = ctx("colabA").firestore();
    // Esta coleção é legível por QUALQUER usuário verificado — é por isso que ela não pode
    // guardar o nome completo de toda a empresa.
    await assertFails(setDoc(doc(db, "diretorioPublico", "colabA"), {
      nome: "Ana Souza", cargo: "Operações", role: "colaborador"
    }));
    await assertFails(setDoc(doc(db, "diretorioPublico", "colabA"), {
      primeiroNome: "Ana Souza", cargo: "Operações", role: "colaborador"
    }));
  });

  it("spoofing: primeiroNome inventado (não derivado do perfil real) é recusado", async () => {
    await seedUsuario("colabA", "colaborador", { nome: "Ana Souza", cargo: "Operações" });
    const db = ctx("colabA").firestore();
    await assertFails(setDoc(doc(db, "diretorioPublico", "colabA"), {
      primeiroNome: "Diretoria", cargo: "Operações", role: "colaborador"
    }));
  });

  it("perfil sem cargo ainda sincroniza (get('cargo', null) — antes a regra ERRAVA e negava)", async () => {
    await semRegras((db) => setDoc(doc(db, "usuarios", "colabSemCargo"), {
      nome: "Bruno Lima", email: `colabSemCargo${DOMINIO}`, cargaHoraria: 8, status: "ativo", role: "colaborador"
    }));
    const db = ctx("colabSemCargo").firestore();
    await assertSucceeds(setDoc(doc(db, "diretorioPublico", "colabSemCargo"), {
      primeiroNome: "Bruno", role: "colaborador"
    }));
  });

  it("BOLA: colaborador comum NÃO grava a entrada de outro uid", async () => {
    await seedUsuario("colabA", "colaborador", { nome: "Ana Souza", cargo: "Operações" });
    await seedUsuario("colabB", "colaborador", { nome: "Bia Reis", cargo: "Financeiro" });
    const db = ctx("colabA").firestore();
    await assertFails(setDoc(doc(db, "diretorioPublico", "colabB"), {
      primeiroNome: "Bia", cargo: "Financeiro", role: "colaborador"
    }));
  });

  it("admin sincroniza a entrada de outro colaborador (criar/editar pelo painel de gestão)", async () => {
    await seedUsuario("admin1", "admin");
    await seedUsuario("colabB", "colaborador", { nome: "Bia Reis", cargo: "Financeiro" });
    const db = ctx("admin1").firestore();
    await assertSucceeds(setDoc(doc(db, "diretorioPublico", "colabB"), {
      primeiroNome: "Bia", cargo: "Financeiro", role: "colaborador"
    }));
  });

  it("DP/RH NÃO sincronizam a entrada de outro colaborador (só Admin/Presidente)", async () => {
    await seedUsuario("dp1", "dp");
    await seedUsuario("colabB", "colaborador", { nome: "Bia Reis", cargo: "Financeiro" });
    const db = ctx("dp1").firestore();
    await assertFails(setDoc(doc(db, "diretorioPublico", "colabB"), {
      primeiroNome: "Bia", cargo: "Financeiro", role: "colaborador"
    }));
  });

  it("mass assignment: campo extra não previsto falha (hasOnly)", async () => {
    await seedUsuario("colabA", "colaborador", { nome: "Ana Souza", cargo: "Operações" });
    const db = ctx("colabA").firestore();
    await assertFails(setDoc(doc(db, "diretorioPublico", "colabA"), {
      primeiroNome: "Ana", cargo: "Operações", role: "colaborador", email: "vazamento@shinerio.com"
    }));
  });

  it("spoofing: cargo/role divergentes do usuarios/{uid} real falham", async () => {
    await seedUsuario("colabA", "colaborador", { nome: "Ana Souza", cargo: "Operações" });
    const db = ctx("colabA").firestore();
    await assertFails(setDoc(doc(db, "diretorioPublico", "colabA"), {
      primeiroNome: "Ana", cargo: "Diretoria", role: "colaborador"
    }));
    await assertFails(setDoc(doc(db, "diretorioPublico", "colabA"), {
      primeiroNome: "Ana", cargo: "Operações", role: "admin"
    }));
  });

  it("presidente NÃO cria a própria entrada (não participa da função)", async () => {
    await seedUsuario("pres1", "presidente", { nome: "Paula Lima", cargo: "Diretoria" });
    const db = ctx("pres1").firestore();
    await assertFails(setDoc(doc(db, "diretorioPublico", "pres1"), {
      primeiroNome: "Paula", cargo: "Diretoria", role: "presidente"
    }));
  });

  it("admin também NÃO consegue criar entrada para o Presidente", async () => {
    await seedUsuario("admin1", "admin");
    await seedUsuario("pres1", "presidente", { nome: "Paula Lima", cargo: "Diretoria" });
    const db = ctx("admin1").firestore();
    await assertFails(setDoc(doc(db, "diretorioPublico", "pres1"), {
      primeiroNome: "Paula", cargo: "Diretoria", role: "presidente"
    }));
  });

  it("qualquer usuário verificado lê o diretório inteiro", async () => {
    await seedUsuario("colabA", "colaborador");
    await seedUsuario("colabB", "colaborador");
    await semRegras((db) => setDoc(doc(db, "diretorioPublico", "colabB"), {
      primeiroNome: "Bia", cargo: "Financeiro", role: "colaborador"
    }));
    const db = ctx("colabA").firestore();
    await assertSucceeds(getDocs(collection(db, "diretorioPublico")));
  });
});

// ---------------------------------------------------------------------------
// Legado da Avaliação de Conduta: nada mais grava; a leitura do próprio titular continua (LGPD).
// ---------------------------------------------------------------------------
describe("legado: votosConduta e condutaContagem", () => {
  it("ninguém grava mais votos nem contagem", async () => {
    await seedUsuario("colabA", "colaborador");
    await seedUsuario("pres1", "presidente");
    for (const uid of ["colabA", "pres1"]) {
      const db = ctx(uid).firestore();
      await assertFails(setDoc(doc(db, "votosConduta", `${uid}_colabB`), { avaliadorUid: uid, avaliadoUid: "colabB", conceito: "bom" }));
      await assertFails(setDoc(doc(db, "condutaContagem", "colabB"), { excelente: 0, bom: 1, regular: 0, insatisfatorio: 0 }));
    }
  });

  it("o titular ainda lê o próprio voto e a própria contagem; outro colaborador não", async () => {
    await seedUsuario("colabA", "colaborador");
    await seedUsuario("colabB", "colaborador");
    await semRegras(async (db) => {
      await setDoc(doc(db, "votosConduta", "colabA_colabB"), { avaliadorUid: "colabA", avaliadoUid: "colabB", conceito: "bom" });
      await setDoc(doc(db, "condutaContagem", "colabB"), { excelente: 0, bom: 1, regular: 0, insatisfatorio: 0 });
    });
    await assertSucceeds(getDoc(doc(ctx("colabA").firestore(), "votosConduta", "colabA_colabB")));
    await assertFails(getDoc(doc(ctx("colabB").firestore(), "votosConduta", "colabA_colabB")));
    await assertSucceeds(getDoc(doc(ctx("colabB").firestore(), "condutaContagem", "colabB")));
    await assertFails(getDoc(doc(ctx("colabA").firestore(), "condutaContagem", "colabB")));
  });

  it("a antiga configuração da conduta não é mais gravável", async () => {
    await seedUsuario("pres1", "presidente");
    await assertFails(setDoc(doc(ctx("pres1").firestore(), "configuracoes", "avaliacaoConduta"),
      { ativo: true, atualizadoPor: "pres1", atualizadoEm: serverTimestamp() }));
  });
});

// ---------------------------------------------------------------------------
// Avaliação de desempenho — configuração, tabela de fixos, ciclos, avaliações e resposta ao
// Presidente. Cenário: colabA é avaliada pelo fixo `fixoA` (colaborador) e escolhe colabB;
// colabP tem o Presidente como fixo; colabC é um terceiro; rh1 é do RH.
// ---------------------------------------------------------------------------
const ANO = new Date().getFullYear();
const PERGUNTAS = ["Pergunta um", "Pergunta dois", "Pergunta três", "Pergunta quatro", "Pergunta cinco"];
const PARECER = "Parecer com mais de vinte caracteres.";

async function definirConfig({ ativo = true, ano = ANO } = {}) {
  await semRegras((db) => setDoc(doc(db, "configuracoes", "avaliacaoDesempenho"),
    { ativo, ano, perguntas: PERGUNTAS, atualizadoPor: "pres1", atualizadoEm: Timestamp.now() }));
}

async function cenarioAvaliacao({ ativo = true } = {}) {
  for (const [uid, role] of [["pres1", "presidente"], ["rh1", "rh"], ["fixoA", "colaborador"], ["colabA", "colaborador"],
    ["colabB", "colaborador"], ["colabC", "colaborador"], ["colabP", "colaborador"]]) {
    await seedUsuario(uid, role);
  }
  await definirConfig({ ativo });
  await semRegras((db) => setDoc(doc(db, "configuracoes", "avaliadoresFixos"),
    { pares: { colabA: "fixoA", colabP: "pres1", rh1: "fixoA" } }));
}

/** Payload de escolherAvaliador() (frontend/js/avaliacao-service.js) na criação do ciclo. */
function novoCiclo(uid, avaliadorFixoUid, avaliadorEscolhidoUid, extra = {}) {
  return {
    uid, ano: ANO, avaliadorFixoUid, avaliadorEscolhidoUid,
    concluidas: { fixo: false, escolhido: false },
    respostaEnviadaEm: null, okPresidenteEm: null, media: null, conceito: null,
    criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp(), ...extra
  };
}
async function semearCiclo(uid, fixo, escolhido, extra = {}) {
  await semRegras((db) => setDoc(doc(db, "ciclosAvaliacao", `${ANO}_${uid}`),
    { ...novoCiclo(uid, fixo, escolhido), criadoEm: Timestamp.now(), atualizadoEm: Timestamp.now(), ...extra }));
}
function respostaDe(avaliadorUid, papel, avaliadoUid = "colabA", extra = {}) {
  return {
    ano: ANO, avaliadoUid, avaliadorUid, papel, perguntas: PERGUNTAS,
    notas: [8, 8, 8, 8, 8], comentario: PARECER, criadoEm: serverTimestamp(), ...extra
  };
}
/** Mesma escrita em lote de enviarResposta(): avaliação + marcação no ciclo. */
function responder(db, papel, resposta, avaliadoUid = "colabA") {
  const lote = writeBatch(db);
  lote.set(doc(db, "respostasAvaliacao", `${ANO}_${avaliadoUid}_${papel}`), resposta);
  lote.update(doc(db, "ciclosAvaliacao", `${ANO}_${avaliadoUid}`), { [`concluidas.${papel}`]: true, atualizadoEm: serverTimestamp() });
  return lote.commit();
}
async function semearResposta(papel, avaliadorUid, notas, avaliadoUid = "colabA") {
  await semRegras((db) => setDoc(doc(db, "respostasAvaliacao", `${ANO}_${avaliadoUid}_${papel}`),
    { ...respostaDe(avaliadorUid, papel, avaliadoUid, { notas }), criadoEm: Timestamp.now() }));
}
/** As duas avaliações feitas: médias 10 e 6 → média 8,0 → "bom". */
async function semearCicloConcluido(extra = {}) {
  await semearCiclo("colabA", "fixoA", "colabB", { concluidas: { fixo: true, escolhido: true }, ...extra });
  await semearResposta("fixo", "fixoA", [10, 10, 10, 10, 10]);
  await semearResposta("escolhido", "colabB", [6, 6, 6, 6, 6]);
}
/** Mesma escrita de enviarRespostaAoPresidente(). */
function enviarAoPresidente(db, texto = "Concordo com as avaliações.", uid = "colabA") {
  const lote = writeBatch(db);
  lote.set(doc(db, "respostasAoPresidente", `${ANO}_${uid}`), { uid, ano: ANO, texto, criadoEm: serverTimestamp() });
  lote.update(doc(db, "ciclosAvaliacao", `${ANO}_${uid}`), { respostaEnviadaEm: serverTimestamp(), atualizadoEm: serverTimestamp() });
  return lote.commit();
}
async function semearRespostaAoPresidente(uid = "colabA") {
  await semRegras((db) => setDoc(doc(db, "respostasAoPresidente", `${ANO}_${uid}`),
    { uid, ano: ANO, texto: "Concordo.", criadoEm: Timestamp.now() }));
}
/** Mesmas escritas de darOk(): fecha o ciclo e cria a avaliação lida pelo motor de cálculo. */
function darOk(db, { media, conceito }) {
  const lote = writeBatch(db);
  lote.update(doc(db, "ciclosAvaliacao", `${ANO}_colabA`),
    { okPresidenteEm: serverTimestamp(), media, conceito, atualizadoEm: serverTimestamp() });
  lote.set(doc(db, "avaliacoes", `desempenho_${ANO}_colabA`), {
    uid: "colabA", data: `${ANO}-11-27`, ano: ANO, conceito,
    justificativa: `Média ${media} na Avaliação de desempenho ${ANO}`, validadoRH: true, avaliadoPor: "pres1",
    criadoEm: serverTimestamp()
  });
  return lote.commit();
}

describe("configuracoes/avaliacaoDesempenho", () => {
  const config = (uid, extra = {}) => ({ ativo: true, ano: ANO, perguntas: PERGUNTAS, atualizadoPor: uid, atualizadoEm: serverTimestamp(), ...extra });

  it("Presidente abre e fecha o ciclo", async () => {
    await seedUsuario("pres1", "presidente");
    const ref = doc(ctx("pres1").firestore(), "configuracoes", "avaliacaoDesempenho");
    await assertSucceeds(setDoc(ref, config("pres1")));
    await assertSucceeds(setDoc(ref, config("pres1", { ativo: false })));
  });

  it("Admin edita só as perguntas: cria fechado, não abre o ciclo nem troca o ano", async () => {
    await seedUsuario("admin1", "admin");
    const ref = doc(ctx("admin1").firestore(), "configuracoes", "avaliacaoDesempenho");
    await assertFails(setDoc(ref, config("admin1")));
    await assertSucceeds(setDoc(ref, config("admin1", { ativo: false })));
    await assertSucceeds(setDoc(ref, config("admin1", { ativo: false, perguntas: [...PERGUNTAS.slice(0, 4), "Nova pergunta"] })));
    await assertFails(setDoc(ref, config("admin1", { ativo: true })));
    await assertFails(setDoc(ref, config("admin1", { ativo: false, ano: ANO + 1 })));
  });

  it("colaborador, DP e RH não gravam; todos leem", async () => {
    for (const [uid, role] of [["colabA", "colaborador"], ["dp1", "dp"], ["rh1", "rh"]]) {
      await seedUsuario(uid, role);
      await assertFails(setDoc(doc(ctx(uid).firestore(), "configuracoes", "avaliacaoDesempenho"), config(uid)));
    }
    await definirConfig();
    await assertSucceeds(getDoc(doc(ctx("colabA").firestore(), "configuracoes", "avaliacaoDesempenho")));
  });

  it("perguntas fora do formato, autoria forjada, ano distante e campo extra falham", async () => {
    await seedUsuario("pres1", "presidente");
    const ref = doc(ctx("pres1").firestore(), "configuracoes", "avaliacaoDesempenho");
    await assertFails(setDoc(ref, config("pres1", { perguntas: PERGUNTAS.slice(0, 4) })));
    await assertFails(setDoc(ref, config("pres1", { perguntas: [...PERGUNTAS.slice(0, 4), ""] })));
    await assertFails(setDoc(ref, config("pres1", { atualizadoPor: "outro" })));
    await assertFails(setDoc(ref, config("pres1", { extra: 1 })));
    await assertFails(setDoc(ref, config("pres1", { ano: ANO + 5 })));
  });
});

describe("configuracoes/avaliadoresFixos", () => {
  it("todos leem; ninguém grava pelo navegador, nem o Presidente", async () => {
    await cenarioAvaliacao();
    await assertSucceeds(getDoc(doc(ctx("colabA").firestore(), "configuracoes", "avaliadoresFixos")));
    for (const uid of ["colabA", "pres1"]) {
      await assertFails(setDoc(doc(ctx(uid).firestore(), "configuracoes", "avaliadoresFixos"), { pares: { colabA: "colabC" } }));
    }
  });
});

describe("ciclosAvaliacao: fixo da tabela e escolha do colega", () => {
  it("colaborador da tabela cria o próprio ciclo com o fixo e um colega", async () => {
    await cenarioAvaliacao();
    await assertSucceeds(setDoc(doc(ctx("colabA").firestore(), "ciclosAvaliacao", `${ANO}_colabA`), novoCiclo("colabA", "fixoA", "colabB")));
  });

  it("o Presidente pode ser o fixo", async () => {
    await cenarioAvaliacao();
    await assertSucceeds(setDoc(doc(ctx("colabP").firestore(), "ciclosAvaliacao", `${ANO}_colabP`), novoCiclo("colabP", "pres1", "colabB")));
  });

  it("fixo diferente da tabela falha", async () => {
    await cenarioAvaliacao();
    const ref = doc(ctx("colabA").firestore(), "ciclosAvaliacao", `${ANO}_colabA`);
    await assertFails(setDoc(ref, novoCiclo("colabA", "colabC", "colabB")));
    await assertFails(setDoc(ref, novoCiclo("colabA", "pres1", "colabB")));
  });

  it("quem não está na tabela não cria ciclo", async () => {
    await cenarioAvaliacao();
    await assertFails(setDoc(doc(ctx("colabC").firestore(), "ciclosAvaliacao", `${ANO}_colabC`), novoCiclo("colabC", "fixoA", "colabB")));
  });

  it("o colega não pode ser o Presidente, o RH, a própria pessoa nem o próprio fixo", async () => {
    await cenarioAvaliacao();
    const ref = doc(ctx("colabA").firestore(), "ciclosAvaliacao", `${ANO}_colabA`);
    for (const alvo of ["pres1", "rh1", "colabA", "fixoA"]) await assertFails(setDoc(ref, novoCiclo("colabA", "fixoA", alvo)));
  });

  it("não pode escolher colega desligado nem inexistente", async () => {
    await cenarioAvaliacao();
    await seedUsuario("colabD", "colaborador", { status: "demitido", motivoPerdaIntegral: "demitido" });
    const ref = doc(ctx("colabA").firestore(), "ciclosAvaliacao", `${ANO}_colabA`);
    await assertFails(setDoc(ref, novoCiclo("colabA", "fixoA", "colabD")));
    await assertFails(setDoc(ref, novoCiclo("colabA", "fixoA", "fantasma")));
  });

  it("com o ciclo fechado, ninguém escolhe", async () => {
    await cenarioAvaliacao({ ativo: false });
    await assertFails(setDoc(doc(ctx("colabA").firestore(), "ciclosAvaliacao", `${ANO}_colabA`), novoCiclo("colabA", "fixoA", "colabB")));
  });

  it("não cria o ciclo de outra pessoa nem nasce com etapas concluídas ou nota", async () => {
    await cenarioAvaliacao();
    const db = ctx("colabA").firestore();
    await assertFails(setDoc(doc(db, "ciclosAvaliacao", `${ANO}_colabP`), novoCiclo("colabP", "pres1", "colabB")));
    const ref = doc(db, "ciclosAvaliacao", `${ANO}_colabA`);
    await assertFails(setDoc(ref, novoCiclo("colabA", "fixoA", "colabB", { concluidas: { fixo: true, escolhido: true } })));
    await assertFails(setDoc(ref, novoCiclo("colabA", "fixoA", "colabB", { media: 10, conceito: "excelente" })));
    await assertFails(setDoc(ref, novoCiclo("colabA", "fixoA", "colabB", { rhDispensado: false })));
  });

  it("troca o colega só enquanto ele ainda não avaliou; o fixo não se troca", async () => {
    await cenarioAvaliacao();
    await semearCiclo("colabA", "fixoA", "colabB");
    const ref = doc(ctx("colabA").firestore(), "ciclosAvaliacao", `${ANO}_colabA`);
    await assertFails(updateDoc(ref, { avaliadorFixoUid: "colabC", atualizadoEm: serverTimestamp() }));
    await assertFails(updateDoc(ref, { avaliadorEscolhidoUid: "fixoA", atualizadoEm: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { avaliadorEscolhidoUid: "colabC", atualizadoEm: serverTimestamp() }));
    await semearCiclo("colabA", "fixoA", "colabC", { concluidas: { fixo: false, escolhido: true } });
    await assertFails(updateDoc(ref, { avaliadorEscolhidoUid: "colabB", atualizadoEm: serverTimestamp() }));
  });
});

describe("respostasAvaliacao: envio", () => {
  it("o fixo e o colega escolhido avaliam com parecer", async () => {
    await cenarioAvaliacao();
    await semearCiclo("colabA", "fixoA", "colabB");
    await assertSucceeds(responder(ctx("fixoA").firestore(), "fixo", respostaDe("fixoA", "fixo")));
    await assertSucceeds(responder(ctx("colabB").firestore(), "escolhido", respostaDe("colabB", "escolhido")));
  });

  it("o Presidente avalia como fixo de quem está com ele na tabela", async () => {
    await cenarioAvaliacao();
    await semearCiclo("colabP", "pres1", "colabB");
    await assertSucceeds(responder(ctx("pres1").firestore(), "fixo", respostaDe("pres1", "fixo", "colabP"), "colabP"));
  });

  it("parecer obrigatório para os dois papéis (mínimo de 20 caracteres)", async () => {
    await cenarioAvaliacao();
    await semearCiclo("colabA", "fixoA", "colabB");
    for (const comentario of ["", "curto demais"]) {
      await assertFails(responder(ctx("colabB").firestore(), "escolhido", respostaDe("colabB", "escolhido", "colabA", { comentario })));
      await assertFails(responder(ctx("fixoA").firestore(), "fixo", respostaDe("fixoA", "fixo", "colabA", { comentario })));
    }
  });

  it("ninguém avalia no papel do outro; Presidente e RH não avaliam quem não é deles", async () => {
    await cenarioAvaliacao();
    await semearCiclo("colabA", "fixoA", "colabB");
    await assertFails(responder(ctx("colabB").firestore(), "fixo", respostaDe("colabB", "fixo")));
    await assertFails(responder(ctx("fixoA").firestore(), "escolhido", respostaDe("fixoA", "escolhido")));
    await assertFails(responder(ctx("colabC").firestore(), "escolhido", respostaDe("colabC", "escolhido")));
    await assertFails(responder(ctx("pres1").firestore(), "fixo", respostaDe("pres1", "fixo")));
    await assertFails(responder(ctx("rh1").firestore(), "fixo", respostaDe("rh1", "fixo")));
  });

  it("papéis antigos (presidente/rh/par) não existem mais", async () => {
    await cenarioAvaliacao();
    await semearCiclo("colabA", "fixoA", "colabB");
    const db = ctx("colabB").firestore();
    const lote = writeBatch(db);
    lote.set(doc(db, "respostasAvaliacao", `${ANO}_colabA_par`), respostaDe("colabB", "par"));
    await assertFails(lote.commit());
  });

  it("notas: exatamente 5 inteiros de 0 a 10", async () => {
    await cenarioAvaliacao();
    await semearCiclo("colabA", "fixoA", "colabB");
    const db = ctx("colabB").firestore();
    for (const notas of [[8, 8, 8, 8, 11], [8, 8, 8, 8, -1], [8, 8, 8, 8, 7.5], [8, 8, 8, 8], [8, 8, 8, 8, "8"]]) {
      await assertFails(responder(db, "escolhido", respostaDe("colabB", "escolhido", "colabA", { notas })));
    }
  });

  it("avaliação e marcação no ciclo só passam juntas", async () => {
    await cenarioAvaliacao();
    await semearCiclo("colabA", "fixoA", "colabB");
    const db = ctx("colabB").firestore();
    await assertFails(setDoc(doc(db, "respostasAvaliacao", `${ANO}_colabA_escolhido`), respostaDe("colabB", "escolhido")));
    await assertFails(updateDoc(doc(db, "ciclosAvaliacao", `${ANO}_colabA`), { "concluidas.escolhido": true, atualizadoEm: serverTimestamp() }));
    // Marcar a etapa do outro avaliador junto com a própria avaliação também falha.
    const lote = writeBatch(db);
    lote.set(doc(db, "respostasAvaliacao", `${ANO}_colabA_escolhido`), respostaDe("colabB", "escolhido"));
    lote.update(doc(db, "ciclosAvaliacao", `${ANO}_colabA`), { "concluidas.escolhido": true, "concluidas.fixo": true, atualizadoEm: serverTimestamp() });
    await assertFails(lote.commit());
  });

  it("com o ciclo fechado não há novas avaliações", async () => {
    await cenarioAvaliacao({ ativo: false });
    await semearCiclo("colabA", "fixoA", "colabB");
    await assertFails(responder(ctx("colabB").firestore(), "escolhido", respostaDe("colabB", "escolhido")));
  });

  it("avaliação enviada é imutável", async () => {
    await cenarioAvaliacao();
    await semearCicloConcluido();
    const ref = (uid) => doc(ctx(uid).firestore(), "respostasAvaliacao", `${ANO}_colabA_escolhido`);
    await assertFails(updateDoc(ref("colabB"), { notas: [10, 10, 10, 10, 10] }));
    await assertFails(deleteDoc(ref("colabB")));
    await assertFails(deleteDoc(ref("pres1")));
  });
});

describe("respostasAvaliacao e ciclosAvaliacao: leitura", () => {
  it("o avaliado só lê as avaliações depois das duas", async () => {
    await cenarioAvaliacao();
    await semearCiclo("colabA", "fixoA", "colabB", { concluidas: { fixo: true, escolhido: false } });
    await semearResposta("fixo", "fixoA", [9, 9, 9, 9, 9]);
    const db = ctx("colabA").firestore();
    await assertFails(getDoc(doc(db, "respostasAvaliacao", `${ANO}_colabA_fixo`)));
    await semearCicloConcluido();
    await assertSucceeds(getDoc(doc(db, "respostasAvaliacao", `${ANO}_colabA_fixo`)));
    await assertSucceeds(getDoc(doc(db, "respostasAvaliacao", `${ANO}_colabA_escolhido`)));
  });

  it("só o Presidente lê as duas; cada avaliador lê a própria; RH e terceiros não leem", async () => {
    await cenarioAvaliacao();
    await semearCicloConcluido();
    const ler = (uid, papel) => getDoc(doc(ctx(uid).firestore(), "respostasAvaliacao", `${ANO}_colabA_${papel}`));
    for (const p of ["fixo", "escolhido"]) await assertSucceeds(ler("pres1", p));
    await assertSucceeds(ler("fixoA", "fixo"));
    await assertFails(ler("fixoA", "escolhido"));
    await assertSucceeds(ler("colabB", "escolhido"));
    await assertFails(ler("colabB", "fixo"));
    await assertFails(ler("rh1", "fixo"));
    await assertFails(ler("colabC", "escolhido"));
  });

  it("ciclo: dono, fixo, escolhido e Presidente leem; RH e terceiro não", async () => {
    await cenarioAvaliacao();
    await semearCiclo("colabA", "fixoA", "colabB");
    const id = `${ANO}_colabA`;
    for (const uid of ["colabA", "fixoA", "colabB", "pres1"]) await assertSucceeds(getDoc(doc(ctx(uid).firestore(), "ciclosAvaliacao", id)));
    for (const uid of ["rh1", "colabC"]) await assertFails(getDoc(doc(ctx(uid).firestore(), "ciclosAvaliacao", id)));
    // O próprio ciclo, antes de existir, pode ser "lido" (o listener da página não falha).
    await assertSucceeds(getDoc(doc(ctx("colabC").firestore(), "ciclosAvaliacao", `${ANO}_colabC`)));
  });

  it("consultas da página: Presidente vê o ano; avaliadores veem onde são fixo ou escolhido", async () => {
    await cenarioAvaliacao();
    await semearCiclo("colabA", "fixoA", "colabB");
    const ciclos = (uid) => collection(ctx(uid).firestore(), "ciclosAvaliacao");
    await assertSucceeds(getDocs(query(ciclos("pres1"), where("ano", "==", ANO))));
    await assertFails(getDocs(query(ciclos("rh1"), where("ano", "==", ANO))));
    await assertFails(getDocs(query(ciclos("colabC"), where("ano", "==", ANO))));
    await assertSucceeds(getDocs(query(ciclos("fixoA"), where("ano", "==", ANO), where("avaliadorFixoUid", "==", "fixoA"))));
    await assertSucceeds(getDocs(query(ciclos("colabB"), where("ano", "==", ANO), where("avaliadorEscolhidoUid", "==", "colabB"))));
  });
});

describe("respostasAoPresidente e ok do Presidente", () => {
  it("o avaliado responde só depois das duas avaliações, uma vez", async () => {
    await cenarioAvaliacao();
    await semearCiclo("colabA", "fixoA", "colabB", { concluidas: { fixo: true, escolhido: false } });
    await assertFails(enviarAoPresidente(ctx("colabA").firestore()));
    await semearCicloConcluido();
    await assertFails(enviarAoPresidente(ctx("colabA").firestore(), ""));
    await assertSucceeds(enviarAoPresidente(ctx("colabA").firestore()));
    await assertFails(enviarAoPresidente(ctx("colabA").firestore(), "Mudei de ideia."));
  });

  it("só o avaliado envia; resposta e marcação no ciclo só passam juntas", async () => {
    await cenarioAvaliacao();
    await semearCicloConcluido();
    await assertFails(enviarAoPresidente(ctx("colabB").firestore()));
    const db = ctx("colabA").firestore();
    await assertFails(setDoc(doc(db, "respostasAoPresidente", `${ANO}_colabA`), { uid: "colabA", ano: ANO, texto: "Oi.", criadoEm: serverTimestamp() }));
    await assertFails(updateDoc(doc(db, "ciclosAvaliacao", `${ANO}_colabA`), { respostaEnviadaEm: serverTimestamp(), atualizadoEm: serverTimestamp() }));
  });

  it("a resposta vai só para o Presidente: avaliadores, RH e terceiros não leem", async () => {
    await cenarioAvaliacao();
    await semearCicloConcluido({ respostaEnviadaEm: Timestamp.now() });
    await semearRespostaAoPresidente();
    const ler = (uid) => getDoc(doc(ctx(uid).firestore(), "respostasAoPresidente", `${ANO}_colabA`));
    await assertSucceeds(ler("colabA"));
    await assertSucceeds(ler("pres1"));
    for (const uid of ["fixoA", "colabB", "rh1", "colabC"]) await assertFails(ler(uid));
  });

  it("resposta ao Presidente é imutável", async () => {
    await cenarioAvaliacao();
    await semearCicloConcluido({ respostaEnviadaEm: Timestamp.now() });
    await semearRespostaAoPresidente();
    const ref = doc(ctx("colabA").firestore(), "respostasAoPresidente", `${ANO}_colabA`);
    await assertFails(updateDoc(ref, { texto: "Outro texto." }));
    await assertFails(deleteDoc(ref));
  });

  it("ok do Presidente com a média e o conceito certos (8,0 → bom)", async () => {
    await cenarioAvaliacao();
    await semearCicloConcluido({ respostaEnviadaEm: Timestamp.now() });
    await assertSucceeds(darOk(ctx("pres1").firestore(), { media: 8, conceito: "bom" }));
  });

  it("ok com conceito ou média adulterados falha", async () => {
    await cenarioAvaliacao();
    await semearCicloConcluido({ respostaEnviadaEm: Timestamp.now() });
    const db = ctx("pres1").firestore();
    await assertFails(darOk(db, { media: 8, conceito: "excelente" }));
    await assertFails(darOk(db, { media: 9.5, conceito: "excelente" }));
  });

  it("sem a resposta do avaliado não há ok; só o Presidente dá o ok, e uma vez", async () => {
    await cenarioAvaliacao();
    await semearCicloConcluido();
    await assertFails(darOk(ctx("pres1").firestore(), { media: 8, conceito: "bom" }));
    await semearCicloConcluido({ respostaEnviadaEm: Timestamp.now() });
    await assertFails(darOk(ctx("fixoA").firestore(), { media: 8, conceito: "bom" }));
    await assertFails(darOk(ctx("rh1").firestore(), { media: 8, conceito: "bom" }));
    await assertSucceeds(darOk(ctx("pres1").firestore(), { media: 8, conceito: "bom" }));
    await assertFails(updateDoc(doc(ctx("pres1").firestore(), "ciclosAvaliacao", `${ANO}_colabA`),
      { okPresidenteEm: serverTimestamp(), media: 10, conceito: "excelente", atualizadoEm: serverTimestamp() }));
  });

  it("média com arredondamento: 89/10 = 8,9 → bom", async () => {
    await cenarioAvaliacao();
    await semearCiclo("colabA", "fixoA", "colabB", { concluidas: { fixo: true, escolhido: true }, respostaEnviadaEm: Timestamp.now() });
    await semearResposta("fixo", "fixoA", [9, 9, 9, 9, 9]);
    await semearResposta("escolhido", "colabB", [9, 9, 9, 9, 8]);
    await assertFails(darOk(ctx("pres1").firestore(), { media: 9, conceito: "excelente" }));
    await assertSucceeds(darOk(ctx("pres1").firestore(), { media: 8.9, conceito: "bom" }));
  });
});

// ---------------------------------------------------------------------------
// Offboarding — vínculo ativo como controle de ACESSO (estaAtivo / gestorAtivo)
// ---------------------------------------------------------------------------
describe("offboarding: gestor sem vínculo ativo perde o acesso", () => {
  const DESLIGAMENTOS = {
    "demitido (status)": { status: "demitido", motivoPerdaIntegral: "demitido" },
    "fraude (só motivoPerdaIntegral, status segue 'ativo')": { status: "ativo", motivoPerdaIntegral: "fraude" },
    "afastado": { status: "afastado" }
  };

  for (const [rotulo, campos] of Object.entries(DESLIGAMENTOS)) {
    it(`DP ${rotulo} NÃO lê dados de terceiros nem lança`, async () => {
      await seedUsuario("dp1", "dp", campos);
      await seedUsuario("colabA", "colaborador");
      await semRegras(async (db) => {
        await setDoc(doc(db, "faltas", "f1"), novaFalta("dp2", "colabA"));
        await setDoc(doc(db, "contratos", "c1"), novoContrato("rh1", "colabA"));
        await setDoc(doc(db, "contratosEmpresariais", "ce1"), { cnpj: "123", status: "ativo" });
      });
      const db = ctx("dp1").firestore();
      await assertFails(getDoc(doc(db, "usuarios", "colabA")));
      await assertFails(getDocs(collection(db, "usuarios")));
      await assertFails(getDoc(doc(db, "faltas", "f1")));
      await assertFails(getDoc(doc(db, "contratos", "c1")));
      await assertFails(getDoc(doc(db, "contratosEmpresariais", "ce1")));
      await assertFails(setDoc(doc(db, "faltas", "f2"), novaFalta("dp1", "colabA")));
      await assertFails(setDoc(doc(db, "logs", "l1"), {
        tipo: "falta", descricao: "x", operadorUid: "dp1", operadorNome: "DP"
      }));
    });
  }

  it("quem foi desligado ainda lê o PRÓPRIO perfil e os próprios lançamentos", async () => {
    await seedUsuario("dp1", "dp", { status: "demitido", motivoPerdaIntegral: "demitido" });
    await semRegras((db) => setDoc(doc(db, "faltas", "f1"), novaFalta("dp2", "dp1")));
    const db = ctx("dp1").firestore();
    await assertSucceeds(getDoc(doc(db, "usuarios", "dp1")));
    await assertSucceeds(getDoc(doc(db, "faltas", "f1")));
  });

  it("quem foi desligado NÃO edita nem o próprio nome", async () => {
    await seedUsuario("colabA", "colaborador", { status: "demitido", motivoPerdaIntegral: "demitido" });
    const db = ctx("colabA").firestore();
    await assertFails(updateDoc(doc(db, "usuarios", "colabA"), { nome: "Outro Nome" }));
  });

  it("Admin desligado NÃO exclui colaborador nem convida ninguém", async () => {
    await seedUsuario("admin1", "admin", { status: "demitido", motivoPerdaIntegral: "demitido" });
    await seedUsuario("colabA", "colaborador");
    const db = ctx("admin1").firestore();
    await assertFails(deleteDoc(doc(db, "usuarios", "colabA")));
    await assertFails(setDoc(doc(db, "cadastrosPendentes", "convidadoX"), {
      nome: "Convidado X", email: `convidadoX${DOMINIO}`, cargo: "Operações", cargaHoraria: 8,
      dataAdmissao: "2026-01-01", fotoBase64: null, criadoPor: "admin1"
    }));
  });

  it("Presidente afastado NÃO lê a fila nem resolve solicitação", async () => {
    await seedUsuario("pres1", "presidente", { status: "afastado" });
    await semRegras((db) => setDoc(doc(db, "solicitacoes", "s1"), novaSolicitacao("dp1", "colabA")));
    const db = ctx("pres1").firestore();
    await assertFails(getDoc(doc(db, "solicitacoes", "s1")));
    await assertFails(updateDoc(doc(db, "solicitacoes", "s1"), {
      status: "aceita", resolvidoPorUid: "pres1", resolvidoEm: "placeholder"
    }));
  });

  it("perfil legado SEM os campos status/motivoPerdaIntegral é tratado como ativo", async () => {
    await semRegras((db) => setDoc(doc(db, "usuarios", "dpLegado"), {
      nome: "DP Legado", email: `dpLegado${DOMINIO}`, cargaHoraria: 8, role: "dp"
    }));
    await seedUsuario("colabA", "colaborador");
    const db = ctx("dpLegado").firestore();
    await assertSucceeds(getDoc(doc(db, "usuarios", "colabA")));
    await assertSucceeds(setDoc(doc(db, "faltas", "f1"), novaFalta("dpLegado", "colabA")));
  });
});

// ---------------------------------------------------------------------------
// usuarios/{uid} — valores do perfil (valoresPerfilValidos vale para TODA escrita)
// ---------------------------------------------------------------------------
describe("usuarios/{uid}: validação de valores", () => {
  it("Admin edita nome/cargo/jornada/admissão de um colaborador (form 'Editar colaborador')", async () => {
    await seedUsuario("admin1", "admin");
    await seedUsuario("colabA", "colaborador");
    const db = ctx("admin1").firestore();
    await assertSucceeds(updateDoc(doc(db, "usuarios", "colabA"), {
      nome: "Ana Souza", cargo: "Financeiro", cargaHoraria: 6, dataAdmissao: "2025-03-01"
    }));
  });

  it("Admin altera o papel de um colaborador para um papel válido", async () => {
    await seedUsuario("admin1", "admin");
    await seedUsuario("colabA", "colaborador");
    const db = ctx("admin1").firestore();
    await assertSucceeds(updateDoc(doc(db, "usuarios", "colabA"), { role: "dp" }));
  });

  for (const [rotulo, campos] of Object.entries({
    "role fora do vocabulário (trancaria a vítima fora do sistema)": { role: "superadmin" },
    "role com payload de HTML": { role: "<img src=x onerror=alert(1)>" },
    "campo fora do schema (mass assignment no update)": { campoNaoPrevisto: "x" },
    "cargaHoraria fora de 4/6/8": { cargaHoraria: 220 },
    "status fora do vocabulário": { status: "inativo" },
    "motivoPerdaIntegral fora do vocabulário": { motivoPerdaIntegral: "qualquer" },
    "dataAdmissao que não é data": { dataAdmissao: "banana1234" },
    "dataAdmissao no futuro": { dataAdmissao: "2999-01-01" },
    "dataAdmissao com mês impossível": { dataAdmissao: "2025-13-01" },
    "e-mail fora do domínio": { email: "colabA@gmail.com" },
    "nome vazio": { nome: "" },
    "foto SVG": { fotoBase64: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" },
    "foto como URL externa (pixel de rastreamento)": { fotoBase64: "https://evil.example/pixel.png" }
  })) {
    it(`Admin NÃO grava ${rotulo}`, async () => {
      await seedUsuario("admin1", "admin");
      await seedUsuario("colabA", "colaborador");
      const db = ctx("admin1").firestore();
      await assertFails(updateDoc(doc(db, "usuarios", "colabA"), campos));
    });
  }

  it("colaborador troca a própria foto por um JPEG em base64 (o que perfil.js envia)", async () => {
    await seedUsuario("colabA", "colaborador");
    const db = ctx("colabA").firestore();
    await assertSucceeds(updateDoc(doc(db, "usuarios", "colabA"), { fotoBase64: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" }));
  });

  it("colaborador NÃO grava foto SVG nem URL externa no próprio perfil", async () => {
    await seedUsuario("colabA", "colaborador");
    const db = ctx("colabA").firestore();
    await assertFails(updateDoc(doc(db, "usuarios", "colabA"), { fotoBase64: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" }));
    await assertFails(updateDoc(doc(db, "usuarios", "colabA"), { fotoBase64: "http://evil.example/p.png" }));
  });

  it("perfil legado sem dataAdmissao/cargo continua editável (o próprio nome)", async () => {
    await semRegras((db) => setDoc(doc(db, "usuarios", "legado"), {
      nome: "Pessoa Legada", email: `legado${DOMINIO}`, cargaHoraria: 8, status: "ativo", role: "colaborador"
    }));
    const db = ctx("legado").firestore();
    await assertSucceeds(updateDoc(doc(db, "usuarios", "legado"), { nome: "Pessoa Legada Silva" }));
  });

  it("RH altera o status de OUTRO colaborador (desligamento) direto", async () => {
    await seedUsuario("rh1", "rh");
    await seedUsuario("colabA", "colaborador");
    const db = ctx("rh1").firestore();
    await assertSucceeds(updateDoc(doc(db, "usuarios", "colabA"), {
      status: "demitido", motivoPerdaIntegral: "demitido", dataDesligamento: "2026-03-10"
    }));
  });

  it("RH NÃO altera o próprio status/motivo (limparia o próprio impedimento)", async () => {
    await seedUsuario("rh1", "rh");
    const db = ctx("rh1").firestore();
    await assertFails(updateDoc(doc(db, "usuarios", "rh1"), { status: "afastado" }));
    await assertFails(updateDoc(doc(db, "usuarios", "rh1"), { motivoPerdaIntegral: null, dataDesligamento: null, status: "ativo", cargo: "x" }));
  });

  it("RH NÃO altera papel nem jornada de outro colaborador", async () => {
    await seedUsuario("rh1", "rh");
    await seedUsuario("colabA", "colaborador");
    const db = ctx("rh1").firestore();
    await assertFails(updateDoc(doc(db, "usuarios", "colabA"), { role: "admin" }));
    await assertFails(updateDoc(doc(db, "usuarios", "colabA"), { cargaHoraria: 4 }));
  });
});

describe("cadastrosPendentes/{uid}: validação de valores", () => {
  function pendente(uid, extra = {}) {
    return { nome: `Colab ${uid}`, email: `${uid}${DOMINIO}`, cargo: "Operações", cargaHoraria: 8,
             dataAdmissao: "2026-01-01", fotoBase64: null, criadoEm: "placeholder", ...extra };
  }

  for (const [rotulo, campos] of Object.entries({
    "dataAdmissao que não é data ('banana1234' tem 10 caracteres)": { dataAdmissao: "banana1234" },
    "dataAdmissao no futuro": { dataAdmissao: "2999-01-01" },
    "dataAdmissao de 100 anos atrás": { dataAdmissao: "1900-01-01" },
    "foto SVG": { fotoBase64: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" },
    "foto como URL externa": { fotoBase64: "https://evil.example/pixel.png" }
  })) {
    it(`autocadastro com ${rotulo} falha`, async () => {
      const db = ctx("novoV", { emailVerificado: false }).firestore();
      await assertFails(setDoc(doc(db, "cadastrosPendentes", "novoV"), pendente("novoV", campos)));
    });
  }

  it("autocadastro com foto JPEG em base64 (o que cadastro.html envia) funciona", async () => {
    const db = ctx("novoF", { emailVerificado: false }).firestore();
    await assertSucceeds(setDoc(doc(db, "cadastrosPendentes", "novoF"),
      pendente("novoF", { fotoBase64: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" })));
  });
});

// ---------------------------------------------------------------------------
// faltas / atrasos / advertencias — schema fechado, autoria e alvo
// ---------------------------------------------------------------------------
for (const colecao of ["faltas", "atrasos", "advertencias"]) {
  describe(`${colecao}/{id}: schema, autoria e alvo`, () => {
    it("mass assignment: campo fora do schema falha", async () => {
      await seedUsuario("dp1", "dp");
      await seedUsuario("colabA", "colaborador");
      const db = ctx("dp1").firestore();
      await assertFails(setDoc(doc(db, colecao, "v1"), novoLancamento(colecao, "dp1", "colabA", { campoExtra: "x" })));
    });

    it("spoofing: registradoPor de outra pessoa falha", async () => {
      await seedUsuario("dp1", "dp");
      await seedUsuario("colabA", "colaborador");
      const db = ctx("dp1").firestore();
      await assertFails(setDoc(doc(db, colecao, "v2"), novoLancamento(colecao, "admin1", "colabA")));
    });

    it("lançamento para um uid que não é colaborador falha", async () => {
      await seedUsuario("dp1", "dp");
      const db = ctx("dp1").firestore();
      await assertFails(setDoc(doc(db, colecao, "v3"), novoLancamento(colecao, "dp1", "uidInexistente")));
    });

    it("DP apaga lançamento de OUTRO colaborador (correção)", async () => {
      await seedUsuario("dp1", "dp");
      await semRegras((db) => setDoc(doc(db, colecao, "v4"), novoLancamento(colecao, "dp2", "colabA")));
      const db = ctx("dp1").firestore();
      await assertSucceeds(deleteDoc(doc(db, colecao, "v4")));
    });

    it("DP NÃO apaga o PRÓPRIO lançamento (é desconto em dinheiro)", async () => {
      await seedUsuario("dp1", "dp");
      await semRegras((db) => setDoc(doc(db, colecao, "v5"), novoLancamento(colecao, "dp2", "dp1")));
      const db = ctx("dp1").firestore();
      await assertFails(deleteDoc(doc(db, colecao, "v5")));
    });

    it("DP NÃO transfere o próprio lançamento para outra pessoa (uid do alvo é imutável)", async () => {
      await seedUsuario("dp1", "dp");
      await seedUsuario("colabA", "colaborador");
      await semRegras((db) => setDoc(doc(db, colecao, "v6"), novoLancamento(colecao, "dp2", "dp1")));
      const db = ctx("dp1").firestore();
      await assertFails(setDoc(doc(db, colecao, "v6"), novoLancamento(colecao, "dp1", "colabA")));
    });
  });
}

describe("faltas / atrasos / advertencias: valores", () => {
  for (const [rotulo, colecao, campos] of [
    ["falta com data que não é data", "faltas", { data: "ontem" }],
    ["falta com tipoJustificativa fora do vocabulário", "faltas", { tipoJustificativa: "<script>" }],
    ["falta com motivo acima de 500 caracteres", "faltas", { motivo: "x".repeat(501) }],
    ["falta com 'justificada' que não é booleano", "faltas", { justificada: "sim" }],
    ["atraso com quantidade 0", "atrasos", { quantidadeAtrasos: 0 }],
    ["atraso com quantidade acima de 31", "atrasos", { quantidadeAtrasos: 9999 }],
    ["atraso com quantidade fracionária", "atrasos", { quantidadeAtrasos: 1.5 }],
    ["atraso com mesAno fora do formato", "atrasos", { mesAno: "março" }],
    ["advertência com tipo fora do vocabulário", "advertencias", { tipo: "<img src=x onerror=alert(1)>" }]
  ]) {
    it(`${rotulo} falha`, async () => {
      await seedUsuario("dp1", "dp");
      await seedUsuario("colabA", "colaborador");
      const db = ctx("dp1").firestore();
      await assertFails(setDoc(doc(db, colecao, "val1"), novoLancamento(colecao, "dp1", "colabA", campos)));
    });
  }

  it("falta justificada com tipo de justificativa válido funciona", async () => {
    await seedUsuario("dp1", "dp");
    await seedUsuario("colabA", "colaborador");
    const db = ctx("dp1").firestore();
    await assertSucceeds(setDoc(doc(db, "faltas", "val2"),
      novaFalta("dp1", "colabA", { justificada: true, tipoJustificativa: "atestado" })));
  });
});

// ---------------------------------------------------------------------------
// contratos / avaliacoes — valores
// ---------------------------------------------------------------------------
describe("contratos/{id}: validação", () => {
  it("RH encerra um contrato existente (update só de status/dataEncerramento)", async () => {
    await seedUsuario("rh1", "rh");
    await seedUsuario("colabA", "colaborador");
    await semRegras((db) => setDoc(doc(db, "contratos", "k1"), novoContrato("rh1", "colabA")));
    const db = ctx("rh1").firestore();
    await assertSucceeds(updateDoc(doc(db, "contratos", "k1"), { status: "encerrado", dataEncerramento: "2026-06-30" }));
  });

  for (const [rotulo, campos] of Object.entries({
    "status fora do vocabulário": { status: "suspenso" },
    "valorCredito negativo": { valorCredito: -150 },
    "dataAtivacao que não é data": { dataAtivacao: "hoje" },
    "campo fora do schema": { campoExtra: "x" }
  })) {
    it(`contrato com ${rotulo} falha`, async () => {
      await seedUsuario("rh1", "rh");
      await seedUsuario("colabA", "colaborador");
      const db = ctx("rh1").firestore();
      await assertFails(setDoc(doc(db, "contratos", "k2"), novoContrato("rh1", "colabA", campos)));
    });
  }

  it("contrato NÃO muda de dono num update", async () => {
    await seedUsuario("rh1", "rh");
    await seedUsuario("colabA", "colaborador");
    await seedUsuario("colabB", "colaborador");
    await semRegras((db) => setDoc(doc(db, "contratos", "k3"), novoContrato("rh1", "colabA")));
    const db = ctx("rh1").firestore();
    await assertFails(updateDoc(doc(db, "contratos", "k3"), { uid: "colabB" }));
  });
});

describe("avaliacoes/{id}: validação", () => {
  for (const [rotulo, campos] of Object.entries({
    "conceito fora do vocabulário": { conceito: "otimo" },
    "campo fora do schema (ex.: 'nota')": { nota: 9 },
    "ano absurdo": { ano: 1990 },
    "justificativa acima de 500 caracteres": { justificativa: "x".repeat(501) }
  })) {
    it(`Presidente NÃO grava avaliação com ${rotulo}`, async () => {
      await seedUsuario("pres1", "presidente");
      await seedUsuario("colabA", "colaborador");
      const db = ctx("pres1").firestore();
      await assertFails(setDoc(doc(db, "avaliacoes", "av1"), novaAvaliacao("pres1", "colabA", campos)));
    });
  }

  it("RH NÃO apaga a PRÓPRIA avaliação", async () => {
    await seedUsuario("rh1", "rh");
    await semRegras((db) => setDoc(doc(db, "avaliacoes", "av2"), novaAvaliacao("pres1", "rh1", { conceito: "insatisfatorio" })));
    const db = ctx("rh1").firestore();
    await assertFails(deleteDoc(doc(db, "avaliacoes", "av2")));
  });
});

// ---------------------------------------------------------------------------
// contratosEmpresariais/{id} — schema da criação e campos travados depois dela
// ---------------------------------------------------------------------------

/** Documento que contratos.js grava ao cadastrar um contrato (payloadCriacao). */
function novoContratoEmpresarial(operadorUid, extra = {}) {
  return {
    nomeEmpresa: "Cliente Exemplo Ltda", cnpj: "11222333000181", valorContrato: 12000,
    dataInicio: "2026-01-01", dataFimPrevista: "2026-12-31", dataFimPrevistaOriginal: "2026-12-31",
    duracaoMesesPrevista: 12, quantidadeFuncionariosIniciais: 10,
    status: "ativo", dataEncerramentoReal: null,
    saidasIniciais: [], entradasContrato: [], pausas: [], pausasQuadroInicial: [], pausasEntradas: [],
    historicoMovimentacoes: [{ tipo: "criacao", descricao: "Crédito inicial", fundoAntes: 0, fundoDepois: 1500, registradoPor: operadorUid }],
    registradoPor: operadorUid,
    ...extra
  };
}

describe("contratosEmpresariais/{id}: validação", () => {
  it("Presidente cadastra um contrato com o payload real do app", async () => {
    await seedUsuario("pres1", "presidente");
    const db = ctx("pres1").firestore();
    await assertSucceeds(setDoc(doc(db, "contratosEmpresariais", "e1"), novoContratoEmpresarial("pres1")));
  });

  it("valor do contrato em branco (null) é aceito — o campo é opcional no formulário", async () => {
    await seedUsuario("pres1", "presidente");
    const db = ctx("pres1").firestore();
    await assertSucceeds(setDoc(doc(db, "contratosEmpresariais", "e2"), novoContratoEmpresarial("pres1", { valorContrato: null })));
  });

  it("contrato de prazo indeterminado (sem data de fim) é aceito", async () => {
    await seedUsuario("pres1", "presidente");
    const db = ctx("pres1").firestore();
    await assertSucceeds(setDoc(doc(db, "contratosEmpresariais", "e7"), novoContratoEmpresarial("pres1", {
      prazoIndeterminado: true, dataFimPrevista: null, dataFimPrevistaOriginal: null, duracaoMesesPrevista: null
    })));
  });

  it("Presidente alterna o contrato para prazo indeterminado", async () => {
    await seedUsuario("pres1", "presidente");
    await semRegras((db) => setDoc(doc(db, "contratosEmpresariais", "e8"), novoContratoEmpresarial("pres1")));
    const db = ctx("pres1").firestore();
    await assertSucceeds(updateDoc(doc(db, "contratosEmpresariais", "e8"), {
      prazoIndeterminado: true, dataFimPrevista: null, duracaoMesesPrevista: null
    }));
    await assertFails(updateDoc(doc(db, "contratosEmpresariais", "e8"), { prazoIndeterminado: "sim" }));
  });

  for (const [rotulo, campos] of Object.entries({
    "prazo indeterminado não-booleano": { prazoIndeterminado: "sim" },
    "CNPJ com caracteres inválidos": { cnpj: "11.222.333/0001" },
    "valor negativo": { valorContrato: -1 },
    "quadro inicial negativo": { quantidadeFuncionariosIniciais: -5 },
    "status fora do vocabulário": { status: "congelado" },
    "campo fora do schema": { campoExtra: "x" },
    "data de início que não é data": { dataInicio: "janeiro" }
  })) {
    it(`contrato empresarial com ${rotulo} falha`, async () => {
      await seedUsuario("pres1", "presidente");
      const db = ctx("pres1").firestore();
      await assertFails(setDoc(doc(db, "contratosEmpresariais", "e3"), novoContratoEmpresarial("pres1", campos)));
    });
  }

  it("Presidente edita prazo/status/quadro (campos mutáveis)", async () => {
    await seedUsuario("pres1", "presidente");
    await semRegras((db) => setDoc(doc(db, "contratosEmpresariais", "e4"), novoContratoEmpresarial("pres1")));
    const db = ctx("pres1").firestore();
    await assertSucceeds(updateDoc(doc(db, "contratosEmpresariais", "e4"), {
      status: "encerrado", dataEncerramentoReal: "2026-08-31", dataFimPrevista: "2026-10-31", duracaoMesesPrevista: 10,
      saidasIniciais: [{ quantidade: 1, data: "2026-05-01" }]
    }));
  });

  it("dados de identidade do contrato são travados depois da criação (nome, CNPJ, valor, início, quadro inicial)", async () => {
    await seedUsuario("pres1", "presidente");
    await semRegras((db) => setDoc(doc(db, "contratosEmpresariais", "e5"), novoContratoEmpresarial("pres1")));
    const db = ctx("pres1").firestore();
    for (const campos of [
      { nomeEmpresa: "Outra Empresa" }, { cnpj: "99888777000166" }, { valorContrato: 999999 },
      { dataInicio: "2020-01-01" }, { quantidadeFuncionariosIniciais: 500 }, { dataFimPrevistaOriginal: "2030-01-01" }
    ]) {
      await assertFails(updateDoc(doc(db, "contratosEmpresariais", "e5"), campos));
    }
  });

  it("update com status fora do vocabulário falha", async () => {
    await seedUsuario("pres1", "presidente");
    await semRegras((db) => setDoc(doc(db, "contratosEmpresariais", "e6"), novoContratoEmpresarial("pres1")));
    const db = ctx("pres1").firestore();
    await assertFails(updateDoc(doc(db, "contratosEmpresariais", "e6"), { status: "congelado" }));
  });
});

// ---------------------------------------------------------------------------
// solicitacoes/{id} — o payload é executado na sessão do Presidente: validado campo a campo
// ---------------------------------------------------------------------------
describe("solicitacoes/{id}: payload", () => {
  it("ESCALADA: 'alterar_status_colaborador' NÃO carrega `role` (era o caminho DP -> Presidente)", async () => {
    await seedUsuario("dp1", "dp");
    const db = ctx("dp1").firestore();
    await assertFails(setDoc(doc(db, "solicitacoes", "p1"), novaSolicitacao("dp1", "dp1", {
      descricao: "Afastamento de João",
      dadosAcao: { uid: "dp1", campos: { role: "presidente" } }
    })));
  });

  it("alvo do payload diferente do alvo exibido ao Presidente falha", async () => {
    await seedUsuario("dp1", "dp");
    const db = ctx("dp1").firestore();
    await assertFails(setDoc(doc(db, "solicitacoes", "p2"), novaSolicitacao("dp1", "colabA", {
      dadosAcao: { uid: "dp1", campos: { status: "ativo", motivoPerdaIntegral: null } }
    })));
  });

  it("tipo fora do vocabulário falha", async () => {
    await seedUsuario("dp1", "dp");
    const db = ctx("dp1").firestore();
    await assertFails(setDoc(doc(db, "solicitacoes", "p3"), novaSolicitacao("dp1", "colabA", { tipo: "promover" })));
  });

  it("campo fora do schema e descrição acima de 500 caracteres falham", async () => {
    await seedUsuario("dp1", "dp");
    const db = ctx("dp1").firestore();
    await assertFails(setDoc(doc(db, "solicitacoes", "p4"), novaSolicitacao("dp1", "colabA", { resolvidoPorUid: "pres1" })));
    await assertFails(setDoc(doc(db, "solicitacoes", "p4"), novaSolicitacao("dp1", "colabA", { descricao: "x".repeat(501) })));
  });

  it("solicitação já nascendo 'aceita' falha", async () => {
    await seedUsuario("dp1", "dp");
    const db = ctx("dp1").firestore();
    await assertFails(setDoc(doc(db, "solicitacoes", "p5"), novaSolicitacao("dp1", "colabA", { status: "aceita" })));
  });

  it("gestor desligado NÃO cria solicitação", async () => {
    await seedUsuario("dp1", "dp", { status: "demitido", motivoPerdaIntegral: "demitido" });
    const db = ctx("dp1").firestore();
    await assertFails(setDoc(doc(db, "solicitacoes", "p6"), novaSolicitacao("dp1", "colabA")));
  });

  // Payloads reais de cada tipo, como gestao.js/contratos.js os montam.
  const PAYLOADS_REAIS = {
    avaliacao: { alvoUid: "colabA", dadosAcao: novaAvaliacao("dp1", "colabA") },
    ativar_contrato: { alvoUid: "colabA", dadosAcao: novoContrato("dp1", "colabA") },
    encerrar_contrato: { alvoUid: "colabA", dadosAcao: { contratoId: "c1", campos: { status: "encerrado", dataEncerramento: "2026-06-30" } } },
    contrato_empresarial_criar: { alvoUid: null, dadosAcao: novoContratoEmpresarial("dp1") },
    contrato_empresarial_editar: { alvoUid: null, dadosAcao: { docId: "e1", campos: { dataFimPrevista: "2026-10-31", duracaoMesesPrevista: 10, historicoMovimentacoes: [] } } },
    contrato_empresarial_excluir: { alvoUid: null, dadosAcao: { docId: "e1" } }
  };
  for (const [tipo, extra] of Object.entries(PAYLOADS_REAIS)) {
    it(`payload real de '${tipo}' é aceito`, async () => {
      await seedUsuario("dp1", "dp");
      const db = ctx("dp1").firestore();
      await assertSucceeds(setDoc(doc(db, "solicitacoes", `ok-${tipo}`), novaSolicitacao("dp1", "colabA", { tipo, ...extra })));
    });
  }

  for (const [rotulo, extra] of Object.entries({
    "'avaliacao' com conceito inválido": { tipo: "avaliacao", dadosAcao: novaAvaliacao("dp1", "colabA", { conceito: "otimo" }) },
    "'avaliacao' para alvo diferente do exibido": { tipo: "avaliacao", dadosAcao: novaAvaliacao("dp1", "dp1") },
    "'encerrar_contrato' alterando o dono do contrato": { tipo: "encerrar_contrato", dadosAcao: { contratoId: "c1", campos: { uid: "dp1" } } },
    "'contrato_empresarial_editar' mexendo em campo travado": { tipo: "contrato_empresarial_editar", alvoUid: null, dadosAcao: { docId: "e1", campos: { valorContrato: 999999 } } },
    "'contrato_empresarial_excluir' com campos extras": { tipo: "contrato_empresarial_excluir", alvoUid: null, dadosAcao: { docId: "e1", campos: { role: "presidente" } } },
    "'contrato_empresarial_criar' carregando `campos`/`uid`": { tipo: "contrato_empresarial_criar", alvoUid: null, dadosAcao: { ...novoContratoEmpresarial("dp1"), uid: "dp1", campos: { role: "presidente" } } }
  })) {
    it(`payload ${rotulo} falha`, async () => {
      await seedUsuario("dp1", "dp");
      const db = ctx("dp1").firestore();
      await assertFails(setDoc(doc(db, "solicitacoes", "px"), novaSolicitacao("dp1", "colabA", extra)));
    });
  }

  it("Presidente NÃO reescreve o payload ao resolver (registro da fila fica auditável)", async () => {
    await seedUsuario("pres1", "presidente");
    await semRegras((db) => setDoc(doc(db, "solicitacoes", "p7"), novaSolicitacao("dp1", "colabA")));
    const db = ctx("pres1").firestore();
    await assertFails(updateDoc(doc(db, "solicitacoes", "p7"), {
      status: "aceita", resolvidoPorUid: "pres1", resolvidoEm: "placeholder",
      dadosAcao: { uid: "colabA", campos: { status: "demitido" } }
    }));
  });

  it("decisão atribuída a outra pessoa (resolvidoPorUid forjado) ou sem autoria falha", async () => {
    await seedUsuario("pres1", "presidente");
    await semRegras((db) => setDoc(doc(db, "solicitacoes", "p8"), novaSolicitacao("dp1", "colabA")));
    const db = ctx("pres1").firestore();
    await assertFails(updateDoc(doc(db, "solicitacoes", "p8"), { status: "aceita", resolvidoPorUid: "admin1" }));
    await assertFails(updateDoc(doc(db, "solicitacoes", "p8"), { status: "aceita" }));
  });
});

// ---------------------------------------------------------------------------
// fundo/{ano}, estatisticas/publico e configuracoes — agregados com schema e autoria
// ---------------------------------------------------------------------------

/** Documento que fundo-service.js publica. */
function novoFundo(operadorUid, extra = {}) {
  return { arrecadado: 18000, estornos: 1500, saldoDisponivel: 16500, somaPesos: 12.5,
           totalContratosAtivos: 3, totalContratosEncerrados: 1,
           atualizadoEm: serverTimestamp(), atualizadoPor: operadorUid, ...extra };
}

describe("fundo/{ano}: validação", () => {
  it("DP publica o agregado do fundo (payload real de fundo-service.js)", async () => {
    await seedUsuario("dp1", "dp");
    const db = ctx("dp1").firestore();
    await assertSucceeds(setDoc(doc(db, "fundo", "2026"), novoFundo("dp1")));
  });

  for (const [rotulo, campos] of Object.entries({
    "saldo negativo": { saldoDisponivel: -1 },
    "somaPesos negativa": { somaPesos: -0.5 },
    "saldo que não é número": { saldoDisponivel: "99999999" },
    "campo fora do schema": { observacao: "x" },
    "autoria de outra pessoa": { atualizadoPor: "admin1" },
    "carimbo de data escolhido pelo cliente": { atualizadoEm: "2020-01-01" }
  })) {
    it(`fundo com ${rotulo} falha`, async () => {
      await seedUsuario("dp1", "dp");
      const db = ctx("dp1").firestore();
      await assertFails(setDoc(doc(db, "fundo", "2026"), novoFundo("dp1", campos)));
    });
  }

  it("fundo sem os campos essenciais (ex.: só { saldo }) falha", async () => {
    await seedUsuario("dp1", "dp");
    const db = ctx("dp1").firestore();
    await assertFails(setDoc(doc(db, "fundo", "2026"), { saldo: 2000 }));
  });

  it("ninguém apaga o agregado do fundo", async () => {
    await seedUsuario("pres1", "presidente");
    await semRegras((db) => setDoc(doc(db, "fundo", "2026"), { saldoDisponivel: 1 }));
    const db = ctx("pres1").firestore();
    await assertFails(deleteDoc(doc(db, "fundo", "2026")));
  });
});

describe("estatisticas/publico: validação", () => {
  it("gestor publica os números da landing page (merge, como fundo-service.js e gestao.js)", async () => {
    await seedUsuario("admin1", "admin");
    const db = ctx("admin1").firestore();
    await assertSucceeds(setDoc(doc(db, "estatisticas", "publico"),
      { arrecadado: 18000, colaboradores: 42, atualizadoEm: serverTimestamp() }, { merge: true }));
    await assertSucceeds(setDoc(doc(db, "estatisticas", "publico"),
      { colaboradoresAnosAnteriores: 120, atualizadoEm: serverTimestamp() }, { merge: true }));
  });

  it("PII não entra no documento público: campo fora dos quatro permitidos falha", async () => {
    await seedUsuario("admin1", "admin");
    const db = ctx("admin1").firestore();
    await assertFails(setDoc(doc(db, "estatisticas", "publico"),
      { arrecadado: 1, colaboradores: 1, nomes: ["Ana Souza"], atualizadoEm: serverTimestamp() }));
  });

  it("valores negativos ou não numéricos falham", async () => {
    await seedUsuario("admin1", "admin");
    const db = ctx("admin1").firestore();
    await assertFails(setDoc(doc(db, "estatisticas", "publico"), { arrecadado: -5, atualizadoEm: serverTimestamp() }));
    await assertFails(setDoc(doc(db, "estatisticas", "publico"), { colaboradores: "muitos", atualizadoEm: serverTimestamp() }));
  });

  it("ninguém apaga o documento público", async () => {
    await seedUsuario("pres1", "presidente");
    await semRegras((db) => setDoc(doc(db, "estatisticas", "publico"), { arrecadado: 1 }));
    const db = ctx("pres1").firestore();
    await assertFails(deleteDoc(doc(db, "estatisticas", "publico")));
  });
});

// ---------------------------------------------------------------------------
// LGPD: registro do aceite dos Termos de Uso / Política de Privacidade
// ---------------------------------------------------------------------------
describe("LGPD: aceite dos termos (aceiteTermos)", () => {
  const VERSAO = "2026-10-27";
  const ontem = () => Timestamp.fromMillis(Date.now() - 86400000);

  it("o próprio colaborador registra o aceite com a hora do servidor", async () => {
    await seedUsuario("colabA", "colaborador");
    const db = ctx("colabA").firestore();
    await assertSucceeds(updateDoc(doc(db, "usuarios", "colabA"), { aceiteTermos: { versao: VERSAO, aceitoEm: serverTimestamp() } }));
  });

  it("aceite com data forjada (não é a hora do servidor) é recusado", async () => {
    await seedUsuario("colabA", "colaborador");
    const db = ctx("colabA").firestore();
    await assertFails(updateDoc(doc(db, "usuarios", "colabA"), { aceiteTermos: { versao: VERSAO, aceitoEm: ontem() } }));
  });

  it("aceite com campo extra ou versão inválida é recusado", async () => {
    await seedUsuario("colabA", "colaborador");
    const db = ctx("colabA").firestore();
    const ref = doc(db, "usuarios", "colabA");
    await assertFails(updateDoc(ref, { aceiteTermos: { versao: VERSAO, aceitoEm: serverTimestamp(), ip: "1.2.3.4" } }));
    await assertFails(updateDoc(ref, { aceiteTermos: { versao: 2026, aceitoEm: serverTimestamp() } }));
    await assertFails(updateDoc(ref, { aceiteTermos: { versao: "", aceitoEm: serverTimestamp() } }));
    await assertFails(updateDoc(ref, { aceiteTermos: true }));
  });

  it("ninguém registra nem apaga o aceite de outra pessoa — nem Admin nem Presidente", async () => {
    await seedUsuario("colabA", "colaborador", { aceiteTermos: { versao: VERSAO, aceitoEm: ontem() } });
    await seedUsuario("admin1", "admin");
    await seedUsuario("pres1", "presidente");
    for (const quem of ["admin1", "pres1"]) {
      const ref = doc(ctx(quem).firestore(), "usuarios", "colabA");
      await assertFails(updateDoc(ref, { aceiteTermos: { versao: "9999", aceitoEm: serverTimestamp() } }));
      await assertFails(updateDoc(ref, { aceiteTermos: null }));
      // O resto da edição de perfil pelo Admin/Presidente continua funcionando.
      await assertSucceeds(updateDoc(ref, { cargo: `Cargo ${quem}` }));
    }
  });

  it("cadastro pendente aceita o registro do aceite, e também sem ele (convite do Admin)", async () => {
    const db = ctx("novoL1", { emailVerificado: false }).firestore();
    const base = { nome: "Colab L1", email: `novoL1${DOMINIO}`, cargo: "Operações", cargaHoraria: 8, dataAdmissao: "2026-01-01", fotoBase64: null, criadoEm: serverTimestamp() };
    await assertSucceeds(setDoc(doc(db, "cadastrosPendentes", "novoL1"), { ...base, aceiteTermos: { versao: VERSAO, aceitoEm: serverTimestamp() } }));
    const db2 = ctx("novoL2", { emailVerificado: false }).firestore();
    await assertSucceeds(setDoc(doc(db2, "cadastrosPendentes", "novoL2"), { ...base, email: `novoL2${DOMINIO}` }));
  });

  it("cadastro pendente com aceite datado no futuro é recusado", async () => {
    const db = ctx("novoL3", { emailVerificado: false }).firestore();
    await assertFails(setDoc(doc(db, "cadastrosPendentes", "novoL3"), {
      nome: "Colab L3", email: `novoL3${DOMINIO}`, cargo: "Operações", cargaHoraria: 8, dataAdmissao: "2026-01-01",
      aceiteTermos: { versao: VERSAO, aceitoEm: Timestamp.fromMillis(Date.now() + 86400000) }
    }));
  });

  it("no 1º login o perfil herda exatamente o aceite do cadastro pendente", async () => {
    const aceite = { versao: VERSAO, aceitoEm: ontem() };
    await seedPendente("colabP", { aceiteTermos: aceite });
    const db = ctx("colabP").firestore();
    const perfil = { nome: "Colab colabP", email: `colabP${DOMINIO}`, cargo: "Operações", cargaHoraria: 8, dataAdmissao: "2026-01-01",
      fotoBase64: null, role: "colaborador", status: "ativo", motivoPerdaIntegral: null, dataDesligamento: null };
    // Aceite diferente do registrado no cadastro (outra versão) é recusado...
    await assertFails(setDoc(doc(db, "usuarios", "colabP"), { ...perfil, aceiteTermos: { versao: "outra", aceitoEm: aceite.aceitoEm } }));
    // ...e o idêntico passa.
    await assertSucceeds(setDoc(doc(db, "usuarios", "colabP"), { ...perfil, aceiteTermos: aceite }));
  });
});
