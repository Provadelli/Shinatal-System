// Shinatal — configuração do Cloudflare Turnstile (anti-bot em cadastro, login e recuperação
// de senha). Veja o passo a passo completo em SETUP.md ("8. Configurar Cloudflare Turnstile").
//
// >>> SUBSTITUA os dois valores abaixo depois de criar o widget e publicar o Worker. <<<
// A site key é PÚBLICA por design do Turnstile (assim como a apiKey do Firebase) — a proteção
// real vem da secret key, que fica só no Worker (nunca aqui, nunca no repositório).
export const TURNSTILE_SITE_KEY = "0x4AAAAAAEvO5QdLcCmmEpng";

// URL do Cloudflare Worker publicado (backend/cloudflare-worker/) — ex.:
// "https://shinatal-turnstile.SEU-SUBDOMINIO.workers.dev"
export const TURNSTILE_WORKER_URL = "https://shinatal-turnstile.shinerioshinatal.workers.dev";

// Enquanto os placeholders acima não forem substituídos, os formulários caem de volta no fluxo
// direto ao Firebase (sem verificação anti-bot) — igual ao comportamento antes desta mudança —
// para o site continuar funcionando durante o setup local. Some sozinho assim que configurado.
//
// Compara com o texto EXATO do placeholder original (não um prefixo): site keys de produção do
// Turnstile também começam com "0x4AAAAAA" e a URL publicada também começa com
// "https://shinatal-turnstile" (é o nome fixo do Worker em wrangler.toml) — checar só o prefixo
// faz isso nunca "ligar" mesmo com as chaves reais já coladas acima.
const SITE_KEY_PLACEHOLDER = "0x4AAAAAAAAAAAAAAAAAAAAA";
const WORKER_URL_PLACEHOLDER = "https://shinatal-turnstile.SEU-SUBDOMINIO.workers.dev";
export const TURNSTILE_CONFIGURADO =
  TURNSTILE_SITE_KEY !== SITE_KEY_PLACEHOLDER && TURNSTILE_WORKER_URL !== WORKER_URL_PLACEHOLDER;