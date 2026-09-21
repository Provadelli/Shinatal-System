// Shinatal — Cloudflare Worker: verificação Turnstile + (para cadastro) a própria criação da
// conta, feita aqui em vez de no navegador.
//
// Por quê o cadastro é criado aqui, e não só "verificado aqui, criado no cliente": se o Worker
// só desse um OK/não-OK e o navegador continuasse chamando o Firebase Auth diretamente, nada
// impediria um script malicioso de pular o Worker e chamar o Firebase direto — o Turnstile viraria
// só decoração. Criando a conta aqui dentro (com o token já validado), o Firebase só é tocado
// depois que o Turnstile aprovou de verdade.
//
// Login e recuperação de senha NÃO têm esse mesmo grau de proteção: são endpoints nativos do
// Firebase Auth que o SDK cliente chama diretamente, e o plano gratuito (Spark) não tem Cloud
// Functions/Blocking Functions para interceptá-los no servidor. Aqui o Worker só verifica o
// token antes do navegador tentar — é uma barreira real contra bots simples/scrapers, mas não
// é criptograficamente à prova de um atacante que decida chamar o Firebase Auth diretamente.
// Documentado também em SETUP.md.
//
// Não usa firebase-admin (não roda em Node — Workers são um runtime V8 isolado, sem os módulos
// nativos que o Admin SDK precisa). Em vez disso, chama as mesmas APIs REST públicas que o SDK
// cliente usa por baixo dos panos (Identity Toolkit) e a API REST do Firestore autenticada com o
// idToken do usuário recém-criado — ou seja, a escrita passa pelas MESMAS firestore.rules de
// sempre, sem nenhum privilégio de admin.

const MAPA_ERRO_AUTH = {
  EMAIL_EXISTS: "auth/email-already-in-use",
  INVALID_EMAIL: "auth/invalid-email",
  WEAK_PASSWORD: "auth/weak-password",
  MISSING_PASSWORD: "auth/weak-password",
  EMAIL_NOT_FOUND: "auth/user-not-found",
  INVALID_PASSWORD: "auth/wrong-password",
  INVALID_LOGIN_CREDENTIALS: "auth/invalid-credential",
  TOO_MANY_ATTEMPTS_TRY_LATER: "auth/too-many-requests",
  USER_DISABLED: "auth/user-disabled"
};

function mapearErroAuth(mensagem) {
  if (!mensagem) return "auth/internal-error";
  const chave = Object.keys(MAPA_ERRO_AUTH).find((k) => mensagem.startsWith(k));
  return chave ? MAPA_ERRO_AUTH[chave] : "auth/internal-error";
}

function corsHeaders(origin, allowedOrigins) {
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
  if (origin && allowedOrigins.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function respostaJson(dados, status, origin, allowedOrigins) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin, allowedOrigins) }
  });
}

async function verificarTurnstile(token, secret, ip) {
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const dados = await res.json();
  return dados.success === true;
}

/** Converte um valor JS simples no formato de "Value" da API REST do Firestore. */
function valorFirestore(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  throw new Error(`Tipo não suportado para o Firestore: ${typeof v}`);
}

function documentoFirestore(campos) {
  const fields = {};
  for (const [chave, valor] of Object.entries(campos)) fields[chave] = valorFirestore(valor);
  return { fields };
}

async function tratarVerificar(request, env, origin, allowedOrigins) {
  const { token } = await request.json();
  const ok = await verificarTurnstile(token, env.TURNSTILE_SECRET_KEY, request.headers.get("CF-Connecting-IP"));
  return respostaJson({ ok }, ok ? 200 : 400, origin, allowedOrigins);
}

// Mesmos limites de cadastroPendenteValido() em firestore.rules — validar aqui devolve um erro
// claro em vez de deixar o Firestore recusar a gravação depois da conta já criada.
// Só exige o domínio (mesmo critério do cliente e das rules, sem restringir a parte local: o
// e-mail de verdade só é provado pelo link de confirmação, não por um formato de caractere).
const REGEX_EMAIL_INSTITUCIONAL = /^[^\s@]+@shinerio\.com$/;
const REGEX_DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const CARGAS_HORARIAS_VALIDAS = [4, 6, 8];
const TAMANHO_MAX_FOTO = 150000;

function cadastroValido({ nome, cargo, cargaHoraria, dataAdmissao, fotoBase64, senha }) {
  if (typeof nome !== "string" || !nome.trim() || nome.length > 120) return false;
  if (typeof cargo !== "string" || !cargo.trim() || cargo.length > 80) return false;
  if (!CARGAS_HORARIAS_VALIDAS.includes(Number(cargaHoraria))) return false;
  if (typeof dataAdmissao !== "string" || !REGEX_DATA_ISO.test(dataAdmissao)) return false;
  if (dataAdmissao > new Date().toISOString().slice(0, 10)) return false;
  if (typeof senha !== "string" || senha.length < 6) return false;
  if (fotoBase64 != null) {
    if (typeof fotoBase64 !== "string" || !fotoBase64.startsWith("data:image/") || fotoBase64.length > TAMANHO_MAX_FOTO) return false;
  }
  return true;
}

async function tratarCadastro(request, env, origin, allowedOrigins) {
  const corpo = await request.json();
  const { token, nome, email, cargo, cargaHoraria, dataAdmissao, fotoBase64, senha } = corpo;

  const turnstileOk = await verificarTurnstile(token, env.TURNSTILE_SECRET_KEY, request.headers.get("CF-Connecting-IP"));
  if (!turnstileOk) return respostaJson({ ok: false, erro: "turnstile" }, 400, origin, allowedOrigins);

  const emailNormalizado = String(email || "").trim().toLowerCase();
  if (!REGEX_EMAIL_INSTITUCIONAL.test(emailNormalizado)) {
    return respostaJson({ ok: false, erro: "auth/invalid-email" }, 400, origin, allowedOrigins);
  }
  if (!cadastroValido({ nome, cargo, cargaHoraria, dataAdmissao, fotoBase64, senha })) {
    // Código próprio (traduzido em auth.js) — "internal-error" faria a pessoa tentar de novo em vão.
    return respostaJson({ ok: false, erro: "shinatal/dados-invalidos" }, 400, origin, allowedOrigins);
  }

  // 1) Cria a conta no Firebase Auth — mesma API REST pública que o SDK cliente usa por baixo
  //    (accounts:signUp), só que só é chamada depois do Turnstile aprovado acima.
  const resSignUp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${env.FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailNormalizado, password: senha, returnSecureToken: true })
    }
  );
  const dadosSignUp = await resSignUp.json();
  if (!resSignUp.ok) {
    return respostaJson({ ok: false, erro: mapearErroAuth(dadosSignUp?.error?.message) }, 400, origin, allowedOrigins);
  }
  const { idToken, localId: uid } = dadosSignUp;

  // 2) Grava o cadastro EM ESPERA em cadastrosPendentes/{uid} — NÃO em usuarios/{uid}. O perfil
  //    real (o que aparece no painel, no fundo e no diretório) só é criado pelo próprio
  //    colaborador no primeiro login, depois de confirmar o e-mail (ver auth.js). Assim, um
  //    cadastro com e-mail inexistente nunca vira colaborador. Autenticado com o idToken do
  //    usuário recém-criado — passa pelas MESMAS firestore.rules de sempre (hasAll/hasOnly
  //    incluídos), sem nenhum atalho de admin. PATCH sem updateMask substitui o documento
  //    inteiro pelos campos abaixo, equivalente ao setDoc() sem merge que o cliente fazia antes.
  const corpoFirestore = documentoFirestore({
    nome: nome.trim(), email: emailNormalizado, cargo: cargo.trim(), cargaHoraria: Number(cargaHoraria),
    fotoBase64: fotoBase64 || null, dataAdmissao, criadoEm: new Date()
  });
  const resFirestore = await fetch(
    `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/cadastrosPendentes/${uid}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(corpoFirestore)
    }
  );
  if (!resFirestore.ok) {
    // Desfaz a conta recém-criada (best-effort, com o mesmo idToken) — senão ela ficaria no Auth
    // sem cadastro pendente, e o e-mail bloqueado por EMAIL_EXISTS numa nova tentativa.
    await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${env.FIREBASE_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken })
    }).catch(() => {});
    const detalhe = await resFirestore.text();
    return respostaJson({ ok: false, erro: "auth/internal-error", detalhe }, 500, origin, allowedOrigins);
  }

  // 3) Dispara o e-mail de verificação (best-effort — mesmo comportamento do fluxo antigo).
  await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${env.FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestType: "VERIFY_EMAIL", idToken })
  }).catch(() => {});

  return respostaJson({ ok: true }, 200, origin, allowedOrigins);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const allowedOrigins = (env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim());
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin, allowedOrigins) });
    }
    if (!env.TURNSTILE_SECRET_KEY) {
      return respostaJson({ ok: false, erro: "TURNSTILE_SECRET_KEY não configurada no Worker" }, 500, origin, allowedOrigins);
    }
    if (request.method !== "POST") {
      return respostaJson({ ok: false, erro: "method-not-allowed" }, 405, origin, allowedOrigins);
    }

    try {
      if (url.pathname === "/api/turnstile/verificar") return await tratarVerificar(request, env, origin, allowedOrigins);
      if (url.pathname === "/api/turnstile/cadastro") return await tratarCadastro(request, env, origin, allowedOrigins);
      return respostaJson({ ok: false, erro: "not-found" }, 404, origin, allowedOrigins);
    } catch (erro) {
      return respostaJson({ ok: false, erro: "auth/internal-error", detalhe: String(erro) }, 500, origin, allowedOrigins);
    }
  }
};
