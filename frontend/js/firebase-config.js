// Shinatal — configuração pública do projeto Firebase, SEM o SDK.
//
// Fica separada de firebase-init.js para páginas leves (a home) lerem o projeto e a chave sem
// baixar o Firebase inteiro. CONFIG_CODIFICADA é gerada por scripts/codificar-config-firebase.mjs
// (npm run config:firebase) a partir de firebase-config.local.json, que fica fora do git.
// Nunca edite a linha à mão. Ver o comentário de firebase-init.js sobre o que protege de verdade.

const CONFIG_CODIFICADA = "==QPI8WmX2fWAC0VXKWoN2FfNTgCsQ+ZoMjIYhlvqn/TDS2VLSWiSilYjbkYMR7SeARJeJVvEDdb2W1dciknmDkJamUJB5qBCxmddww3SiIPxXhIK7xjnalZKfgeAF6BJl2ca8g3Q+4P4TBNF/AiNyBdOLFbUZKAa8zIHc1jR3NYr2UZdfhzgWCcMXhKZQuQZdnYHRVjLisfjCUZe+Ui2WgYBCkcXIfUWdTIe5FgMDdfg/BNRSUjpOAQHTQNXQrHZJhCZI1jj3NQMiEWQqRwR+jMWGCOewtSKJGeZgwrcKvYGyVReeVpF6kPNmQJ98vQak3O.qsj7lirDCXiF/3C7EzGBvCHQ2ZpM7tFQ";

function decodificar(blob) {
  if (!blob) return {};
  const [chaveB64, dadosB64] = blob.split("").reverse().join("").split(".");
  const paraBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const chave = paraBytes(chaveB64);
  const dados = paraBytes(dadosB64).map((b, i) => b ^ chave[i % chave.length]);
  return JSON.parse(new TextDecoder().decode(dados));
}

const { recaptchaSiteKey, ...firebaseConfig } = decodificar(CONFIG_CODIFICADA);

export { firebaseConfig, recaptchaSiteKey };

// API REST do Firestore — usada pela home para ler o documento público sem o SDK.
export const FIRESTORE_REST = "https://firestore.googleapis.com/v1";
