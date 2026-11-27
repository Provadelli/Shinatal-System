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
// Avaliação de desempenho — configuracoes/avaliacaoDesempenho, ciclosAvaliacao, respostasAvaliacao
// ---------------------------------------------------------------------------
const ANO = new Date().getFullYear();
const PERGUNTAS = ["Pergunta um", "Pergunta dois", "Pergunta três", "Pergunta quatro", "Pergunta cinco"];
const COMENTARIO = "Comentário com mais de vinte caracteres.";

async function definirConfig({ ativo = true, ano = ANO } = {}) {
  await semRegras((db) => setDoc(doc(db, "configuracoes", "avaliacaoDesempenho"),
    { ativo, ano, perguntas: PERGUNTAS, atualizadoPor: "pres1", atualizadoEm: Timestamp.now() }));
}

/** Presidente, RH, o avaliado (colabA), o colega escolhido (colabB) e um terceiro (colabC). */
async function cenarioAvaliacao({ ativo = true } = {}) {
  await seedUsuario("pres1", "presidente");
  await seedUsuario("rh1", "rh");
  await seedUsuario("colabA", "colaborador");
  await seedUsuario("colabB", "colaborador");
  await seedUsuario("colabC", "colaborador");
  await definirConfig({ ativo });
}

/** Payload de escolherAvaliador() (frontend/js/avaliacao-service.js) na criação do ciclo. */
function novoCiclo(uid, avaliadorUid, extra = {}) {
  return {
    uid, ano: ANO, avaliadorUid,
    concluidas: { presidente: false, rh: false, par: false }, rhDispensado: false,
    parecer: null, parecerEm: null, okPresidenteEm: null, media: null, conceito: null,
    criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp(), ...extra
  };
}
async function semearCiclo(uid, avaliadorUid, extra = {}) {
  await semRegras((db) => setDoc(doc(db, "ciclosAvaliacao", `${ANO}_${uid}`),
    { ...novoCiclo(uid, avaliadorUid), criadoEm: Timestamp.now(), atualizadoEm: Timestamp.now(), ...extra }));
}
function respostaDe(avaliadorUid, papel, avaliadoUid = "colabA", extra = {}) {
  return {
    ano: ANO, avaliadoUid, avaliadorUid, papel, perguntas: PERGUNTAS,
    notas: [8, 8, 8, 8, 8], comentario: COMENTARIO, criadoEm: serverTimestamp(), ...extra
  };
}
/** Mesma escrita em lote de enviarResposta(): resposta + marcação no ciclo. */
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
/** As três avaliações feitas: médias 10, 8 e 6 → média 8,0 → "bom". */
async function semearCicloConcluido(extra = {}) {
  await semearCiclo("colabA", "colabB", { concluidas: { presidente: true, rh: true, par: true }, ...extra });
  await semearResposta("presidente", "pres1", [10, 10, 10, 10, 10]);
  await semearResposta("rh", "rh1", [8, 8, 8, 8, 8]);
  await semearResposta("par", "colabB", [6, 6, 6, 6, 6]);
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
      const db = ctx(uid).firestore();
      await assertFails(setDoc(doc(db, "configuracoes", "avaliacaoDesempenho"), config(uid)));
    }
    await definirConfig();
    await assertSucceeds(getDoc(doc(ctx("colabA").firestore(), "configuracoes", "avaliacaoDesempenho")));
  });

  it("perguntas fora do formato, autoria forjada e campo extra falham", async () => {
    await seedUsuario("pres1", "presidente");
    const ref = doc(ctx("pres1").firestore(), "configuracoes", "avaliacaoDesempenho");
    await assertFails(setDoc(ref, config("pres1", { perguntas: PERGUNTAS.slice(0, 4) })));
    await assertFails(setDoc(ref, config("pres1", { perguntas: [...PERGUNTAS.slice(0, 4), ""] })));
    await assertFails(setDoc(ref, config("pres1", { atualizadoPor: "outro" })));
    await assertFails(setDoc(ref, config("pres1", { extra: 1 })));
    await assertFails(setDoc(ref, config("pres1", { ano: ANO + 5 })));
  });
});

describe("ciclosAvaliacao: escolha do avaliador", () => {
  it("colaborador cria o próprio ciclo escolhendo um colega", async () => {
    await cenarioAvaliacao();
    const db = ctx("colabA").firestore();
    await assertSucceeds(setDoc(doc(db, "ciclosAvaliacao", `${ANO}_colabA`), novoCiclo("colabA", "colabB")));
  });

  it("não pode escolher o Presidente, o RH nem a si mesmo", async () => {
    await cenarioAvaliacao();
    const db = ctx("colabA").firestore();
    for (const alvo of ["pres1", "rh1", "colabA"]) {
      await assertFails(setDoc(doc(db, "ciclosAvaliacao", `${ANO}_colabA`), novoCiclo("colabA", alvo)));
    }
  });

  it("não pode escolher colega desligado nem inexistente", async () => {
    await cenarioAvaliacao();
    await seedUsuario("colabD", "colaborador", { status: "demitido", motivoPerdaIntegral: "demitido" });
    const db = ctx("colabA").firestore();
    await assertFails(setDoc(doc(db, "ciclosAvaliacao", `${ANO}_colabA`), novoCiclo("colabA", "colabD")));
    await assertFails(setDoc(doc(db, "ciclosAvaliacao", `${ANO}_colabA`), novoCiclo("colabA", "fantasma")));
  });

  it("com o ciclo fechado, ninguém escolhe", async () => {
    await cenarioAvaliacao({ ativo: false });
    const db = ctx("colabA").firestore();
    await assertFails(setDoc(doc(db, "ciclosAvaliacao", `${ANO}_colabA`), novoCiclo("colabA", "colabB")));
  });

  it("não cria o ciclo de outra pessoa nem nasce com etapas concluídas", async () => {
    await cenarioAvaliacao();
    const db = ctx("colabA").firestore();
    await assertFails(setDoc(doc(db, "ciclosAvaliacao", `${ANO}_colabC`), novoCiclo("colabC", "colabB")));
    await assertFails(setDoc(doc(db, "ciclosAvaliacao", `${ANO}_colabA`),
      novoCiclo("colabA", "colabB", { concluidas: { presidente: true, rh: true, par: true } })));
    await assertFails(setDoc(doc(db, "ciclosAvaliacao", `${ANO}_colabA`), novoCiclo("colabA", "colabB", { media: 10, conceito: "excelente" })));
  });

  it("o Presidente não é avaliado", async () => {
    await cenarioAvaliacao();
    const db = ctx("pres1").firestore();
    await assertFails(setDoc(doc(db, "ciclosAvaliacao", `${ANO}_pres1`), novoCiclo("pres1", "colabB")));
  });

  it("troca o colega só enquanto ele ainda não avaliou", async () => {
    await cenarioAvaliacao();
    await semearCiclo("colabA", "colabB");
    const db = ctx("colabA").firestore();
    const ref = doc(db, "ciclosAvaliacao", `${ANO}_colabA`);
    await assertSucceeds(updateDoc(ref, { avaliadorUid: "colabC", atualizadoEm: serverTimestamp() }));
    await semearCiclo("colabA", "colabC", { concluidas: { presidente: false, rh: false, par: true } });
    await assertFails(updateDoc(ref, { avaliadorUid: "colabB", atualizadoEm: serverTimestamp() }));
  });
});

describe("respostasAvaliacao: envio", () => {
  it("o colega escolhido avalia; comentário opcional para ele", async () => {
    await cenarioAvaliacao();
    await semearCiclo("colabA", "colabB");
    const db = ctx("colabB").firestore();
    await assertSucceeds(responder(db, "par", respostaDe("colabB", "par", "colabA", { comentario: "" })));
  });

  it("Presidente e RH avaliam com comentário; sem comentário (ou curto) falha", async () => {
    await cenarioAvaliacao();
    await semearCiclo("colabA", "colabB");
    await assertFails(responder(ctx("rh1").firestore(), "rh", respostaDe("rh1", "rh", "colabA", { comentario: "curto" })));
    await assertSucceeds(responder(ctx("rh1").firestore(), "rh", respostaDe("rh1", "rh")));
    await assertFails(responder(ctx("pres1").firestore(), "presidente", respostaDe("pres1", "presidente", "colabA", { comentario: "" })));
    await assertSucceeds(responder(ctx("pres1").firestore(), "presidente", respostaDe("pres1", "presidente")));
  });

  it("quem não foi escolhido não avalia como colega; ninguém assume o papel de outro", async () => {
    await cenarioAvaliacao();
    await semearCiclo("colabA", "colabB");
    await assertFails(responder(ctx("colabC").firestore(), "par", respostaDe("colabC", "par")));
    await assertFails(responder(ctx("colabB").firestore(), "presidente", respostaDe("colabB", "presidente")));
    await assertFails(responder(ctx("rh1").firestore(), "par", respostaDe("rh1", "par")));
  });

  it("o RH não avalia a si mesmo", async () => {
    await cenarioAvaliacao();
    await semearCiclo("rh1", "colabB");
    await assertFails(responder(ctx("rh1").firestore(), "rh", respostaDe("rh1", "rh", "rh1"), "rh1"));
  });

  it("notas: exatamente 5 inteiros de 0 a 10", async () => {
    await cenarioAvaliacao();
    await semearCiclo("colabA", "colabB");
    const db = ctx("colabB").firestore();
    for (const notas of [[8, 8, 8, 8, 11], [8, 8, 8, 8, -1], [8, 8, 8, 8, 7.5], [8, 8, 8, 8], [8, 8, 8, 8, "8"]]) {
      await assertFails(responder(db, "par", respostaDe("colabB", "par", "colabA", { notas })));
    }
  });

  it("resposta e marcação no ciclo só passam juntas", async () => {
    await cenarioAvaliacao();
    await semearCiclo("colabA", "colabB");
    const db = ctx("colabB").firestore();
    await assertFails(setDoc(doc(db, "respostasAvaliacao", `${ANO}_colabA_par`), respostaDe("colabB", "par")));
    await assertFails(updateDoc(doc(db, "ciclosAvaliacao", `${ANO}_colabA`), { "concluidas.par": true, atualizadoEm: serverTimestamp() }));
    // Marcar a etapa de outro avaliador junto com a própria resposta também falha.
    const lote = writeBatch(db);
    lote.set(doc(db, "respostasAvaliacao", `${ANO}_colabA_par`), respostaDe("colabB", "par"));
    lote.update(doc(db, "ciclosAvaliacao", `${ANO}_colabA`), { "concluidas.par": true, "concluidas.presidente": true, atualizadoEm: serverTimestamp() });
    await assertFails(lote.commit());
  });

  it("com o ciclo fechado não há novas respostas", async () => {
    await cenarioAvaliacao({ ativo: false });
    await semearCiclo("colabA", "colabB");
    await assertFails(responder(ctx("colabB").firestore(), "par", respostaDe("colabB", "par")));
  });

  it("resposta enviada é imutável", async () => {
    await cenarioAvaliacao();
    await semearCicloConcluido();
    const db = ctx("colabB").firestore();
    await assertFails(updateDoc(doc(db, "respostasAvaliacao", `${ANO}_colabA_par`), { notas: [10, 10, 10, 10, 10] }));
    await assertFails(deleteDoc(doc(db, "respostasAvaliacao", `${ANO}_colabA_par`)));
    await assertFails(deleteDoc(doc(ctx("pres1").firestore(), "respostasAvaliacao", `${ANO}_colabA_par`)));
  });
});

describe("respostasAvaliacao e ciclosAvaliacao: leitura", () => {
  it("o avaliado só lê as respostas depois das três avaliações", async () => {
    await cenarioAvaliacao();
    await semearCiclo("colabA", "colabB", { concluidas: { presidente: true, rh: false, par: true } });
    await semearResposta("presidente", "pres1", [9, 9, 9, 9, 9]);
    const db = ctx("colabA").firestore();
    await assertFails(getDoc(doc(db, "respostasAvaliacao", `${ANO}_colabA_presidente`)));
    await semearCicloConcluido();
    await assertSucceeds(getDoc(doc(db, "respostasAvaliacao", `${ANO}_colabA_presidente`)));
    await assertSucceeds(getDoc(doc(db, "respostasAvaliacao", `${ANO}_colabA_par`)));
  });

  it("só o Presidente lê todas; RH e colega leem só a própria; terceiro não lê nada", async () => {
    await cenarioAvaliacao();
    await semearCicloConcluido();
    const id = (p) => `${ANO}_colabA_${p}`;
    for (const p of ["presidente", "rh", "par"]) await assertSucceeds(getDoc(doc(ctx("pres1").firestore(), "respostasAvaliacao", id(p))));
    await assertSucceeds(getDoc(doc(ctx("rh1").firestore(), "respostasAvaliacao", id("rh"))));
    await assertFails(getDoc(doc(ctx("rh1").firestore(), "respostasAvaliacao", id("presidente"))));
    await assertSucceeds(getDoc(doc(ctx("colabB").firestore(), "respostasAvaliacao", id("par"))));
    await assertFails(getDoc(doc(ctx("colabB").firestore(), "respostasAvaliacao", id("rh"))));
    await assertFails(getDoc(doc(ctx("colabC").firestore(), "respostasAvaliacao", id("par"))));
  });

  it("ciclo: dono, colega escolhido, Presidente e RH leem; terceiro não", async () => {
    await cenarioAvaliacao();
    await semearCiclo("colabA", "colabB");
    const id = `${ANO}_colabA`;
    for (const uid of ["colabA", "colabB", "pres1", "rh1"]) await assertSucceeds(getDoc(doc(ctx(uid).firestore(), "ciclosAvaliacao", id)));
    await assertFails(getDoc(doc(ctx("colabC").firestore(), "ciclosAvaliacao", id)));
    // O próprio ciclo, antes de existir, pode ser "lido" (o listener da página não falha).
    await assertSucceeds(getDoc(doc(ctx("colabC").firestore(), "ciclosAvaliacao", `${ANO}_colabC`)));
  });

  it("consultas da página: ciclos do ano (Presidente/RH) e ciclos em que fui escolhido", async () => {
    await cenarioAvaliacao();
    await semearCiclo("colabA", "colabB");
    const { query, where } = await import("firebase/firestore");
    await assertSucceeds(getDocs(query(collection(ctx("pres1").firestore(), "ciclosAvaliacao"), where("ano", "==", ANO))));
    await assertSucceeds(getDocs(query(collection(ctx("rh1").firestore(), "ciclosAvaliacao"), where("ano", "==", ANO))));
    await assertFails(getDocs(query(collection(ctx("colabC").firestore(), "ciclosAvaliacao"), where("ano", "==", ANO))));
    await assertSucceeds(getDocs(query(collection(ctx("colabB").firestore(), "ciclosAvaliacao"),
      where("ano", "==", ANO), where("avaliadorUid", "==", "colabB"))));
  });
});

describe("ciclosAvaliacao: parecer, dispensa do RH e ok do Presidente", () => {
  const parecer = (texto = "Concordo com a avaliação.") => ({ parecer: texto, parecerEm: serverTimestamp(), atualizadoEm: serverTimestamp() });

  it("parecer só depois das três avaliações, uma vez e só pelo avaliado", async () => {
    await cenarioAvaliacao();
    await semearCiclo("colabA", "colabB", { concluidas: { presidente: true, rh: true, par: false } });
    const ref = (uid) => doc(ctx(uid).firestore(), "ciclosAvaliacao", `${ANO}_colabA`);
    await assertFails(updateDoc(ref("colabA"), parecer()));
    await semearCicloConcluido();
    await assertFails(updateDoc(ref("colabB"), parecer()));
    await assertFails(updateDoc(ref("colabA"), parecer("")));
    await assertSucceeds(updateDoc(ref("colabA"), parecer()));
    await assertFails(updateDoc(ref("colabA"), parecer("Mudei de ideia.")));
  });

  it("ok do Presidente com a média e o conceito certos (8,0 → bom)", async () => {
    await cenarioAvaliacao();
    await semearCicloConcluido({ parecer: "Concordo.", parecerEm: Timestamp.now() });
    await assertSucceeds(darOk(ctx("pres1").firestore(), { media: 8, conceito: "bom" }));
  });

  it("ok com conceito ou média adulterados falha", async () => {
    await cenarioAvaliacao();
    await semearCicloConcluido({ parecer: "Concordo.", parecerEm: Timestamp.now() });
    const db = ctx("pres1").firestore();
    await assertFails(darOk(db, { media: 8, conceito: "excelente" }));
    await assertFails(darOk(db, { media: 9.5, conceito: "excelente" }));
  });

  it("sem parecer não há ok; só o Presidente dá o ok, e uma vez", async () => {
    await cenarioAvaliacao();
    await semearCicloConcluido();
    await assertFails(darOk(ctx("pres1").firestore(), { media: 8, conceito: "bom" }));
    await semearCicloConcluido({ parecer: "Concordo.", parecerEm: Timestamp.now() });
    await assertFails(darOk(ctx("rh1").firestore(), { media: 8, conceito: "bom" }));
    await assertSucceeds(darOk(ctx("pres1").firestore(), { media: 8, conceito: "bom" }));
    await assertFails(updateDoc(doc(ctx("pres1").firestore(), "ciclosAvaliacao", `${ANO}_colabA`),
      { okPresidenteEm: serverTimestamp(), media: 10, conceito: "excelente", atualizadoEm: serverTimestamp() }));
  });

  it("RH avaliado: o Presidente dispensa a etapa do RH e a média usa duas avaliações", async () => {
    await cenarioAvaliacao();
    await semearCiclo("rh1", "colabB");
    const ref = doc(ctx("pres1").firestore(), "ciclosAvaliacao", `${ANO}_rh1`);
    await assertSucceeds(updateDoc(ref, { rhDispensado: true, atualizadoEm: serverTimestamp() }));
    await semearCiclo("rh1", "colabB", {
      rhDispensado: true, concluidas: { presidente: true, rh: false, par: true }, parecer: "Ok.", parecerEm: Timestamp.now()
    });
    await semearResposta("presidente", "pres1", [10, 10, 10, 10, 9], "rh1");
    await semearResposta("par", "colabB", [9, 9, 9, 9, 9], "rh1");
    // 94/10 = 9,4 → excelente
    await assertSucceeds(updateDoc(ref, { okPresidenteEm: serverTimestamp(), media: 9.4, conceito: "excelente", atualizadoEm: serverTimestamp() }));
  });

  it("não se dispensa o RH de quem não é do RH", async () => {
    await cenarioAvaliacao();
    await semearCiclo("colabA", "colabB");
    await assertFails(updateDoc(doc(ctx("pres1").firestore(), "ciclosAvaliacao", `${ANO}_colabA`),
      { rhDispensado: true, atualizadoEm: serverTimestamp() }));
  });
});
