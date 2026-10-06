/**
 * Shinatal — Seed dos usuários especiais (Admin, DP, RH).
 *
 * Script Node standalone: roda UMA VEZ, localmente, com o Firebase Admin SDK.
 * Não é implantado (não é Cloud Function) — o plano gratuito (Spark) é suficiente.
 *
 * Uso:
 *   1. npm install firebase-admin   (dentro da pasta scripts/, ou na raiz do projeto)
 *   2. Baixe a chave de conta de serviço em:
 *      Console Firebase > Configurações do projeto > Contas de serviço > Gerar nova chave privada
 *      Salve o arquivo como scripts/service-account.json (NUNCA suba este arquivo ao git).
 *   3. node scripts/seed-usuarios.js
 */

const crypto = require("crypto");
const admin = require("firebase-admin");
const serviceAccount = require("./service-account.json");

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

// Sem senha fixa no código: cada conta NOVA recebe uma senha aleatória forte, mostrada uma única
// vez neste terminal. A antiga senha padrão ficou no histórico do git e deve ser considerada
// vazada — ver docs/security/auditoria-firestore-2026-09.md.
function gerarSenhaTemporaria() {
  return crypto.randomBytes(18).toString("base64url");
}
const senhasCriadas = [];

const USUARIOS = [
  { email: "ti@shinerio.com", nome: "Administrador TI", cargo: "Tecnologia da Informação", role: "admin" },
  { email: "dp@shinerio.com", nome: "Departamento Pessoal", cargo: "Departamento Pessoal", role: "dp" },
  { email: "rh@shinerio.com", nome: "Recursos Humanos", cargo: "Recursos Humanos", role: "rh" },
  { email: "shinerio@shinerio.com", nome: "Presidente", cargo: "Presidência", role: "presidente" }
];

async function principal() {
  for (const u of USUARIOS) {
    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(u.email);
      console.log(`Já existe no Auth: ${u.email} (uid ${userRecord.uid})`);
    } catch {
      const senha = gerarSenhaTemporaria();
      userRecord = await admin.auth().createUser({
        email: u.email,
        password: senha,
        displayName: u.nome,
        emailVerified: true
      });
      senhasCriadas.push({ email: u.email, senha });
      console.log(`Criado no Auth: ${u.email} (uid ${userRecord.uid})`);
    }

    await admin.firestore().collection("usuarios").doc(userRecord.uid).set({
      nome: u.nome,
      email: u.email,
      cargo: u.cargo,
      cargaHoraria: 8,
      role: u.role,
      status: "ativo",
      motivoPerdaIntegral: null,
      fotoBase64: null,
      dataAdmissao: new Date().toISOString().slice(0, 10),
      dataDesligamento: null,
      criadoEm: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`Perfil Firestore gravado para ${u.email} (role: ${u.role}).`);
  }

  console.log("\nConcluído!");
  if (senhasCriadas.length) {
    // Não ficam salvas em lugar nenhum: entregue cada uma pessoalmente e peça a troca no primeiro
    // acesso ("Esqueci minha senha" na tela de login).
    console.log("Senhas temporárias das contas criadas agora (anote — não serão mostradas de novo):");
    for (const { email, senha } of senhasCriadas) console.log(`  ${email}: ${senha}`);
  }
  process.exit(0);
}

principal().catch((erro) => {
  console.error("Falha ao rodar o seed:", erro);
  process.exit(1);
});
