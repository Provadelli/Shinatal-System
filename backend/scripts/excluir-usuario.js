/**
 * Shinatal — Excluir um usuário por completo (Firebase Auth + Firestore).
 *
 * O painel de gestão (gestao.html, botão "Excluir colaborador") já apaga o documento
 * `usuarios/{uid}` pelo navegador — suficiente para tirar a pessoa do sistema (sem esse
 * documento ela é deslogada no próximo carregamento de página). Mas o SDK do navegador não
 * pode apagar a CONTA de Auth de outra pessoa — só a Admin SDK consegue, por isso este script
 * roda localmente, uma vez, quando quiser liberar o e-mail para reuso.
 *
 * Uso:
 *   1. npm install firebase-admin   (dentro da pasta scripts/, ou na raiz do projeto)
 *   2. Baixe a chave de conta de serviço em:
 *      Console Firebase > Configurações do projeto > Contas de serviço > Gerar nova chave privada
 *      Salve o arquivo como scripts/service-account.json (NUNCA suba este arquivo ao git).
 *   3. node scripts/excluir-usuario.js email@shinerio.com
 */

const admin = require("firebase-admin");
const serviceAccount = require("./service-account.json");

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

async function principal() {
  const email = process.argv[2];
  if (!email) {
    console.error("Uso: node scripts/excluir-usuario.js email@shinerio.com");
    process.exit(1);
  }

  let uid = null;
  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    uid = userRecord.uid;
    await admin.auth().deleteUser(uid);
    console.log(`Conta removida do Firebase Auth: ${email} (uid ${uid})`);
  } catch (erro) {
    if (erro.code === "auth/user-not-found") {
      console.log(`Nenhuma conta de Auth encontrada para ${email} (talvez já tenha sido removida).`);
    } else {
      throw erro;
    }
  }

  if (uid) {
    // Além do perfil: o cadastro em espera (nome, e-mail, foto — dado pessoal) e a entrada no
    // diretório de conduta, que também ficariam para trás.
    for (const colecao of ["usuarios", "cadastrosPendentes", "diretorioPublico"]) {
      const doc = admin.firestore().collection(colecao).doc(uid);
      if ((await doc.get()).exists) {
        await doc.delete();
        console.log(`Removido do Firestore: ${colecao}/${uid}`);
      }
    }
  }

  console.log("Concluído.");
  process.exit(0);
}

principal().catch((erro) => {
  console.error("Falha ao excluir o usuário:", erro);
  process.exit(1);
});
