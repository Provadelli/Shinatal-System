/**
 * Shinatal — Migração/limpeza de contas com e-mail NÃO confirmado.
 *
 * Contexto: antes da correção, quem se cadastrava ganhava o perfil `usuarios/{uid}` na hora — mesmo
 * com um e-mail inexistente — e aparecia no painel de gestão/fundo sem nunca ter confirmado o
 * e-mail. Agora o cadastro fica "em espera" (`cadastrosPendentes/{uid}`) e só vira colaborador no
 * primeiro login depois da confirmação (ver firestore.rules e auth.js). Este script resolve o
 * legado e serve de faxina periódica (o plano gratuito Spark não tem Cloud Functions/cron, e o
 * SDK do navegador não consegue listar/apagar contas de Auth de outras pessoas):
 *
 *   - conta NÃO verificada, criada há MENOS de N dias  -> MOVE o perfil para cadastrosPendentes
 *     (some do painel; se o e-mail for real, a pessoa confirma, entra e é promovida);
 *   - conta NÃO verificada, criada há N dias ou mais   -> EXCLUI a conta do Auth + usuarios,
 *     diretorioPublico e cadastrosPendentes — a menos que já existam lançamentos (faltas, atrasos,
 *     advertências, avaliações, contratos) ligados àquele uid: aí só reporta, para o DP/RH decidir;
 *   - cadastrosPendentes de contas já verificadas e com perfil (sobra de promoção) -> exclui o doc;
 *   - contas SEM documento em usuarios/cadastrosPendentes (ex.: cadastro que falhou no meio) e não
 *     verificadas há N dias ou mais -> exclui só a conta do Auth.
 *
 * Nunca toca contas verificadas, nem perfis com role diferente de 'colaborador'
 * (admin/dp/rh/presidente).
 *
 * Por padrão só SIMULA e imprime o que faria. Nada é alterado sem --apply.
 *
 * Uso:
 *   1. npm install   (dentro da pasta backend/scripts/)
 *   2. Tenha a chave de conta de serviço em backend/scripts/service-account.json
 *      (NUNCA suba este arquivo ao git — ver excluir-usuario.js para o passo a passo).
 *   3. node limpar-nao-verificados.js                 # simulação (dry-run), padrão 3 dias
 *      node limpar-nao-verificados.js --dias 7        # troca o prazo de exclusão
 *      node limpar-nao-verificados.js --apply         # executa de verdade
 */

const admin = require("firebase-admin");
const serviceAccount = require("./service-account.json");

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

// Argumentos estritos: um flag digitado errado (ex.: '--dias=7' antes era ignorado, ou '--aplly')
// não pode passar em silêncio — o script exclui contas e rodaria com o prazo padrão sem o
// operador saber.
function lerArgumentos(argv) {
  const uso = "Uso: node limpar-nao-verificados.js [--dias N | --dias=N] [--apply]   (N = inteiro >= 0)";
  let aplicar = false;
  let dias = 3;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") {
      aplicar = true;
    } else if (a === "--dias" || a.startsWith("--dias=")) {
      const valor = a === "--dias" ? argv[++i] : a.slice("--dias=".length);
      if (!/^\d+$/.test(valor ?? "")) {
        console.error(uso);
        process.exit(1);
      }
      dias = Number(valor);
    } else {
      console.error(`Argumento desconhecido: ${a}\n${uso}`);
      process.exit(1);
    }
  }
  return { aplicar, dias };
}
const { aplicar: APLICAR, dias: DIAS } = lerArgumentos(process.argv.slice(2));
const LIMITE_MS = DIAS * 24 * 60 * 60 * 1000;

const db = admin.firestore();
const auth = admin.auth();

// Coleções com lançamentos ligados a um colaborador pelo campo `uid`.
const COLECOES_COM_LANCAMENTOS = ["faltas", "atrasos", "advertencias", "avaliacoes", "contratos"];

// Campos que o cadastro pendente aceita (mesmo schema de cadastroPendenteValido() nas rules).
const CAMPOS_PENDENTE = ["nome", "email", "cargo", "cargaHoraria", "dataAdmissao", "fotoBase64", "criadoEm", "criadoPor"];

async function listarTodasContas() {
  const contas = [];
  let pageToken;
  do {
    const pagina = await auth.listUsers(1000, pageToken);
    contas.push(...pagina.users);
    pageToken = pagina.pageToken;
  } while (pageToken);
  return contas;
}

async function temLancamentos(uid) {
  const resultados = await Promise.all(
    COLECOES_COM_LANCAMENTOS.map((colecao) => db.collection(colecao).where("uid", "==", uid).limit(1).get())
  );
  const i = resultados.findIndex((snap) => !snap.empty);
  return i >= 0 ? COLECOES_COM_LANCAMENTOS[i] : null;
}

function idadeMs(conta) {
  return Date.now() - new Date(conta.metadata.creationTime).getTime();
}

const resumo = { movidos: 0, excluidos: 0, bloqueados: 0, sobras: 0, orfaos: 0, ignorados: 0 };

async function moverParaPendentes(conta, perfil) {
  const dados = {};
  for (const campo of CAMPOS_PENDENTE) {
    if (perfil[campo] !== undefined) dados[campo] = perfil[campo];
  }
  console.log(`  -> MOVER para cadastrosPendentes: ${conta.email} (uid ${conta.uid})`);
  if (APLICAR) {
    await db.collection("cadastrosPendentes").doc(conta.uid).set(dados);
    await db.collection("usuarios").doc(conta.uid).delete();
    await db.collection("diretorioPublico").doc(conta.uid).delete();
  }
  resumo.movidos++;
}

async function excluirConta(conta, { perfil }) {
  const colecao = perfil ? await temLancamentos(conta.uid) : null;
  if (colecao) {
    console.log(`  -> MANTIDO (há lançamentos em "${colecao}" ligados a este uid — revise com o DP/RH): ${conta.email} (uid ${conta.uid})`);
    resumo.bloqueados++;
    return;
  }
  console.log(`  -> EXCLUIR conta + perfil: ${conta.email} (uid ${conta.uid})`);
  if (APLICAR) {
    await db.collection("cadastrosPendentes").doc(conta.uid).delete();
    await db.collection("diretorioPublico").doc(conta.uid).delete();
    await db.collection("usuarios").doc(conta.uid).delete();
    await auth.deleteUser(conta.uid);
  }
  resumo.excluidos++;
}

async function principal() {
  console.log(`Modo: ${APLICAR ? "APLICAR (alterações reais)" : "SIMULAÇÃO (nada será alterado — use --apply)"} | prazo de exclusão: ${DIAS} dia(s)\n`);

  const contas = await listarTodasContas();
  const naoVerificadas = contas.filter((c) => !c.emailVerified);
  console.log(`${contas.length} conta(s) no Auth, ${naoVerificadas.length} sem e-mail confirmado.\n`);

  for (const conta of naoVerificadas) {
    console.log(`${conta.email || "(sem e-mail)"} — criada em ${conta.metadata.creationTime}`);
    const antiga = idadeMs(conta) >= LIMITE_MS;

    const snapPerfil = await db.collection("usuarios").doc(conta.uid).get();
    const perfil = snapPerfil.exists ? snapPerfil.data() : null;

    if (perfil && perfil.role !== "colaborador") {
      console.log(`  -> IGNORADO: perfil com papel "${perfil.role}" (só colaboradores são tratados aqui).`);
      resumo.ignorados++;
      continue;
    }

    if (perfil) {
      // Perfil "vivo" de uma conta não verificada — é exatamente o bug: precisa sair do painel.
      if (antiga) await excluirConta(conta, { perfil });
      else await moverParaPendentes(conta, perfil);
      continue;
    }

    // Sem perfil: ou já está em cadastrosPendentes (fluxo novo, tudo certo) ou é conta órfã.
    const snapPendente = await db.collection("cadastrosPendentes").doc(conta.uid).get();
    if (antiga) {
      await excluirConta(conta, { perfil: null });
    } else if (snapPendente.exists) {
      console.log("  -> ok (cadastro pendente aguardando confirmação do e-mail)");
    } else {
      console.log("  -> conta sem cadastro (recente) — será reavaliada na próxima execução.");
    }
  }

  // Varredura da própria coleção cadastrosPendentes — pega o que o laço acima (que parte das
  // contas do Auth) não alcança:
  //  - ÓRFÃOS: a conta de Auth não existe mais (ex.: excluída no console). O doc guarda nome,
  //    e-mail e foto — dado pessoal que não pode ficar para sempre sem dono.
  //  - SOBRAS: a pessoa já tem perfil (a promoção criou o perfil mas não conseguiu apagar o
  //    pendente). Nada lê esta coleção, mas um pendente ao lado de um perfil é um risco: se o
  //    perfil for excluído depois, a pessoa se re-promoveria no próximo login.
  const pendentes = (await db.collection("cadastrosPendentes").get()).docs;
  for (let i = 0; i < pendentes.length; i += 100) {
    const lote = pendentes.slice(i, i + 100);
    const { notFound } = await auth.getUsers(lote.map((p) => ({ uid: p.id })));
    const semConta = new Set(notFound.map((n) => n.uid));
    const perfis = await db.getAll(...lote.map((p) => db.collection("usuarios").doc(p.id)));
    const apagar = [];
    lote.forEach((p, idx) => {
      if (semConta.has(p.id)) {
        console.log(`Órfão: cadastrosPendentes/${p.id} (conta de Auth não existe mais) -> EXCLUIR`);
        resumo.orfaos++;
        apagar.push(p);
      } else if (perfis[idx].exists) {
        console.log(`Sobra: cadastrosPendentes/${p.id} (perfil já existe) -> EXCLUIR`);
        resumo.sobras++;
        apagar.push(p);
      }
    });
    if (APLICAR) await Promise.all(apagar.map((p) => p.ref.delete()));
  }

  console.log(
    `\nResumo${APLICAR ? "" : " (simulação)"}: ${resumo.movidos} movido(s) para pendentes, ${resumo.excluidos} excluído(s), ` +
    `${resumo.bloqueados} mantido(s) por terem lançamentos, ${resumo.sobras} sobra(s) e ${resumo.orfaos} órfão(s) de pendentes, ` +
    `${resumo.ignorados} ignorado(s).`
  );
  if (!APLICAR) console.log("Nada foi alterado. Rode com --apply para executar.");
  process.exit(0);
}

principal().catch((erro) => {
  console.error("Falha ao limpar contas não verificadas:", erro);
  process.exit(1);
});
