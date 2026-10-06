// Shinatal — gera a configuração codificada do Firebase usada em frontend/js/firebase-init.js.
//
// Os valores reais ficam em firebase-config.local.json (raiz do projeto, fora do git — ver
// .gitignore). Este script os cifra (XOR com uma chave aleatória nova a cada execução + base64)
// e grava o resultado no lugar de CONFIG_CODIFICADA em firebase-init.js.
//
// Uso:  npm run config:firebase
//
// Formato de firebase-config.local.json:
//   { "apiKey": "...", "authDomain": "...", "projectId": "...", "appId": "...",
//     "recaptchaSiteKey": "chave do site do reCAPTCHA/Fraud Defense (vazio = App Check desligado)" }
//
// LIMITE (importante): isto tira a chave do código-fonte visível (Ctrl+U, leitura do .js), mas o
// navegador precisa decifrá-la para falar com o Firebase — quem abrir o DevTools (aba Rede) ainda
// a vê. A proteção de verdade é o App Check (só o nosso site, validado pelo reCAPTCHA, é aceito)
// somado às restrições da chave no Google Cloud e às firestore.rules.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGEM = path.join(RAIZ, "firebase-config.local.json");
const DESTINO = path.join(RAIZ, "frontend/js/firebase-init.js");

if (!existsSync(ORIGEM)) {
  console.error(`Não encontrei ${ORIGEM}. Crie o arquivo com os valores do projeto (ver o topo deste script).`);
  process.exit(1);
}
const config = JSON.parse(readFileSync(ORIGEM, "utf8"));
for (const campo of ["apiKey", "authDomain", "projectId", "appId"]) {
  if (!config[campo]) {
    console.error(`firebase-config.local.json sem o campo obrigatório "${campo}".`);
    process.exit(1);
  }
}

const chave = randomBytes(24);
const dados = Buffer.from(JSON.stringify(config), "utf8");
const cifrado = Buffer.alloc(dados.length);
for (let i = 0; i < dados.length; i++) cifrado[i] = dados[i] ^ chave[i % chave.length];
// Chave e conteúdo vão juntos, separados por ".", e o conjunto invertido — nenhum trecho
// reconhecível (nem o prefixo "AIza" de uma API key do Google) aparece no arquivo.
const blob = `${chave.toString("base64")}.${cifrado.toString("base64")}`.split("").reverse().join("");

const atual = readFileSync(DESTINO, "utf8");
const re = /const CONFIG_CODIFICADA = "[^"]*";/;
if (!re.test(atual)) {
  console.error("Não encontrei a linha CONFIG_CODIFICADA em firebase-init.js.");
  process.exit(1);
}
writeFileSync(DESTINO, atual.replace(re, `const CONFIG_CODIFICADA = "${blob}";`));
console.log(`Configuração codificada gravada em frontend/js/firebase-init.js (App Check ${config.recaptchaSiteKey ? "LIGADO" : "desligado — recaptchaSiteKey vazio"}).`);
