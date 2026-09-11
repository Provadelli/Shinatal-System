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

  it("autocadastro com e-mail fora do domínio institucional falha", async () => {
    const db = ctx("intruso", { email: "intruso@gmail.com" }).firestore();
    await assertFails(
      setDoc(doc(db, "usuarios", "intruso"), {
        nome: "Intruso",
        email: "intruso@gmail.com",
        cargaHoraria: 220,
        status: "ativo",
        role: "colaborador"
      })
    );
  });

  it("regex de domínio não é enganado por sufixo (attacker@shinerio.com.evil.io)", async () => {
    const db = ctx("intruso2", { email: "intruso2@shinerio.com.evil.io" }).firestore();
    await assertFails(
      setDoc(doc(db, "usuarios", "intruso2"), {
        nome: "Intruso2",
        email: "intruso2@shinerio.com.evil.io",
        cargaHoraria: 220,
        status: "ativo",
        role: "colaborador"
      })
    );
  });

  it("autocadastro tentando nascer como admin falha (só 'colaborador' é permitido)", async () => {
    const db = ctx("colabC").firestore();
    await assertFails(
      setDoc(doc(db, "usuarios", "colabC"), {
        nome: "Colab C",
        email: "colabC@shinerio.com",
        cargaHoraria: 220,
        status: "ativo",
        role: "admin"
      })
    );
  });

  it("mass assignment: create NÃO aceita campos extras não previstos pelo app (remediado com hasOnly)", async () => {
    const db = ctx("colabD").firestore();
    await assertFails(
      setDoc(doc(db, "usuarios", "colabD"), {
        nome: "Colab D",
        email: "colabD@shinerio.com",
        cargaHoraria: 220,
        status: "ativo",
        role: "colaborador",
        campoNaoPrevisto: "valor-injetado-pelo-cliente"
      })
    );
  });

  it("create com o schema completo legítimo (autocadastro, cadastro.html) ainda funciona", async () => {
    const db = ctx("colabD2").firestore();
    await assertSucceeds(
      setDoc(doc(db, "usuarios", "colabD2"), {
        nome: "Colab D2",
        email: "colabD2@shinerio.com",
        cargo: "Operações",
        cargaHoraria: 8,
        fotoBase64: null,
        role: "colaborador",
        status: "ativo",
        motivoPerdaIntegral: null,
        dataAdmissao: "2026-01-01",
        dataDesligamento: null,
        criadoEm: "placeholder"
      })
    );
  });

  it("create com o schema completo legítimo (Admin cria colaborador, gestao.js) ainda funciona", async () => {
    await seedUsuario("admin1", "admin");
    const db = ctx("admin1").firestore();
    await assertSucceeds(
      setDoc(doc(db, "usuarios", "colabD3"), {
        nome: "Colab D3",
        cargo: "Operações",
        cargaHoraria: 8,
        email: "colabD3@shinerio.com",
        role: "colaborador",
        status: "ativo",
        motivoPerdaIntegral: null,
        dataAdmissao: "2026-01-01",
        dataDesligamento: null,
        fotoBase64: null,
        criadoPor: "admin1",
        criadoEm: "placeholder"
      })
    );
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
