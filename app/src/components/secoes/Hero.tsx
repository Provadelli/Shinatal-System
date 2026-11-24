import { useEffect, useRef, useState } from "react";
// m (não motion): com LazyMotion no App, o motor de animação carrega à parte, fora do pacote inicial.
import { m as motion } from "framer-motion";
import { ArrowDown, Pause, PiggyBank, Play, Users } from "lucide-react";
import { firebaseConfig, FIRESTORE_REST } from "@legado/firebase-config.js";
import { BotaoPilula } from "@/components/ui/botao-pilula";
import { cascata, surgirTopo as surgir, EASE_BRAND } from "@/lib/movimento";
import { TITULO_HERO, TEXTO_ABERTURA, TEXTO_CORRIDO } from "@/lib/tipografia";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------------------------
// Números do Fundo — lidos de "estatisticas/publico" (documento agregado público, publicado por
// js/gestao.js) pela API REST do Firestore e relidos a cada minuto enquanto a aba está visível.
// Sem o documento, ou offline, ficam valores de exemplo para a página não ficar vazia.
// ---------------------------------------------------------------------------------------------
const EXEMPLO = { arrecadado: 9867, colaboradores: 358, anteriores: 0 };
const URL_ESTATISTICAS = `${FIRESTORE_REST}/projects/${firebaseConfig.projectId}/databases/(default)/documents/estatisticas/publico?key=${firebaseConfig.apiKey}`;
const INTERVALO_ATUALIZACAO_MS = 60_000;

type CampoRest = { integerValue?: string; doubleValue?: number } | undefined;
type Numeros = { arrecadado: number; colaboradores: number; anteriores: number };

/** Valor numérico de um campo no formato da API REST ({ integerValue: "65" } / { doubleValue: 1.5 }). */
function numeroDoCampo(campo: CampoRest): number | null {
  const bruto = campo?.integerValue ?? campo?.doubleValue;
  const n = Number(bruto);
  return bruto !== undefined && Number.isFinite(n) ? n : null;
}

function useNumerosDoFundo() {
  const [numeros, setNumeros] = useState<Numeros | null>(null);
  useEffect(() => {
    let ultima = "";
    let ativo = true;
    async function ler() {
      let campos: Record<string, CampoRest> = {};
      try {
        const resposta = await fetch(URL_ESTATISTICAS, { cache: "no-store" });
        if (resposta.ok) campos = (await resposta.json()).fields || {};
      } catch { /* offline — mantém o exemplo */ }
      const novos: Numeros = {
        arrecadado: numeroDoCampo(campos.arrecadado) ?? EXEMPLO.arrecadado,
        colaboradores: numeroDoCampo(campos.colaboradores) ?? EXEMPLO.colaboradores,
        anteriores: numeroDoCampo(campos.colaboradoresAnosAnteriores) ?? EXEMPLO.anteriores
      };
      // Só reanima quando algo mudou — a releitura de minuto em minuto não fica "piscando".
      const assinatura = `${novos.arrecadado}|${novos.colaboradores}|${novos.anteriores}`;
      if (ativo && assinatura !== ultima) {
        ultima = assinatura;
        setNumeros(novos);
      }
    }
    ler();
    const id = setInterval(() => { if (!document.hidden) ler(); }, INTERVALO_ATUALIZACAO_MS);
    return () => { ativo = false; clearInterval(id); };
  }, []);
  return numeros;
}

/** Número que cresce de 0 até o valor (animarNumero de ui-utils.js; pula direto com "reduzir movimento"). */
function NumeroAnimado({ valor, moeda = false, id, className }: { valor: number; moeda?: boolean; id?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let ativo = true;
    // Import dinâmico: ui-utils.js importa acessibilidade.js, que precisa da página já montada.
    import("@legado/ui-utils.js").then(({ animarNumero, formatarMoeda }) => {
      if (!ativo || !ref.current) return;
      const formatador = moeda ? formatarMoeda : (v: number) => Math.round(v).toString();
      animarNumero(ref.current, valor, { formatador });
    });
    return () => { ativo = false; };
  }, [valor, moeda]);
  return <span ref={ref} id={id} className={className} />;
}

// ---------------------------------------------------------------------------------------------
// Vídeo do topo — duas versões leves: vertical (celular em pé) e horizontal (computador). Fica
// só no pôster com "reduzir movimento", Data Saver ou 2G. O download começa com o navegador
// ocioso, depois do carregamento, para não disputar banda com a primeira tela.
// ---------------------------------------------------------------------------------------------
function useVideoDeFundo(ref: React.RefObject<HTMLVideoElement>) {
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const prefereReduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const conexao = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const conexaoMuitoFraca = !!conexao && (conexao.saveData || ["slow-2g", "2g"].includes(conexao.effectiveType ?? ""));
    const podeAutoplay = !prefereReduzido && !conexaoMuitoFraca;
    let movimentoPausado = () => false;
    import("@legado/acessibilidade.js").then((m) => { movimentoPausado = m.movimentoPausado; });

    const aoMudarVisibilidade = () => {
      if (!podeAutoplay) return;
      if (document.hidden || movimentoPausado()) video.pause();
      else video.play().catch(() => {});
    };

    if (podeAutoplay) {
      // Lido por acessibilidade.js: "Pausar animações" só retoma o vídeo se o autoplay era permitido.
      video.dataset.autoplayPermitido = "1";
      const retrato = window.matchMedia("(max-aspect-ratio: 1/1)").matches;
      const iniciar = () => {
        if (video.src) return;
        video.src = (retrato ? video.dataset.srcRetrato : video.dataset.srcPaisagem) ?? "";
        video.preload = "auto";
        video.addEventListener("playing", () => video.classList.add("video-pronto"), { once: true });
        if (!movimentoPausado()) video.play().catch(() => {});
      };
      const quandoOcioso = () =>
        "requestIdleCallback" in window ? requestIdleCallback(iniciar, { timeout: 3000 }) : setTimeout(iniciar, 1500);
      if (document.readyState === "complete") quandoOcioso();
      else window.addEventListener("load", quandoOcioso, { once: true });
    }
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => document.removeEventListener("visibilitychange", aoMudarVisibilidade);
  }, [ref]);
}

/** Luz que segue o cursor no card do Fundo (só com mouse; uma escrita de estilo por quadro). */
function useLuzQueSegue(ref: React.RefObject<HTMLDivElement>) {
  useEffect(() => {
    const card = ref.current;
    if (!card || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let x = 0, y = 0, agendado = false;
    const aplicar = () => {
      agendado = false;
      const caixa = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${x - caixa.left}px`);
      card.style.setProperty("--my", `${y - caixa.top}px`);
    };
    const mover = (e: MouseEvent) => {
      x = e.clientX;
      y = e.clientY;
      if (!agendado) { agendado = true; requestAnimationFrame(aplicar); }
    };
    card.addEventListener("mousemove", mover);
    return () => card.removeEventListener("mousemove", mover);
  }, [ref]);
}

/**
 * "Bem-vindo ao Shinatal": cada palavra sobe de dentro de uma máscara (overflow hidden), um
 * brilho dourado passa uma vez pelo texto (.titulo-brilho, CSS) e o logo se revela da esquerda
 * para a direita. O texto continua um h1 comum para leitores de tela.
 */
function TituloHero() {
  const palavras = ["Bem-vindo", "ao"];
  return (
    <h1 className={cn(TITULO_HERO, "mt-6 text-white")}>
      {palavras.map((palavra, i) => (
        <span key={palavra}>
          <span className="inline-block overflow-hidden pb-[0.08em] -mb-[0.08em] align-bottom">
            <motion.span
              className="titulo-brilho inline-block"
              initial={{ y: "105%" }}
              animate={{ y: "0%" }}
              transition={{ duration: 1.1, ease: EASE_BRAND, delay: 0.15 + i * 0.12 }}
            >
              {palavra}
            </motion.span>
          </span>
          {i < palavras.length - 1 && " "}
        </span>
      ))}
      <br />
      <motion.img
        src="/assets/logoshinatal-cropped.webp"
        width={320}
        height={121}
        alt="Shinatal"
        className="logo-vermelho h-12 sm:h-14 lg:h-[4.5rem] w-auto inline-block align-middle mt-3"
        initial={{ clipPath: "inset(0 100% 0 0)", opacity: 0.01 }}
        animate={{ clipPath: "inset(0 0% 0 0)", opacity: 1 }}
        transition={{ duration: 1.2, ease: EASE_BRAND, delay: 0.5 }}
      />
    </h1>
  );
}

export function Hero() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const numeros = useNumerosDoFundo();
  const ano = new Date().getFullYear();
  useVideoDeFundo(videoRef);
  useLuzQueSegue(cardRef);

  return (
    <section className="secao-hero-video flex items-center">
      <video
        ref={videoRef}
        id="video-hero"
        data-video-fundo=""
        data-src-retrato="/assets/hero-retrato-v3.mp4"
        data-src-paisagem="/assets/hero-paisagem-v3.mp4"
        muted
        loop
        playsInline
        preload="none"
        disablePictureInPicture
        {...{ disableremoteplayback: "" }}
        aria-hidden="true"
        tabIndex={-1}
      />
      <span aria-hidden="true" className="grade-tecnica grade-tecnica--hero" />
      {/* Ícone e texto trocados por js/acessibilidade.js (aria-pressed + .botao-movimento-texto). */}
      <button type="button" data-pausar-movimento="" aria-pressed="false" aria-label="Pausar animações da página" className="botao-movimento">
        <Pause className="icone-pausar h-5 w-5" aria-hidden="true" />
        <Play className="icone-retomar h-5 w-5" aria-hidden="true" />
        <span className="botao-movimento-texto">Pausar animações</span>
      </button>

      <div className="hero-video-conteudo w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-14 md:py-24 grid md:grid-cols-2 gap-12 lg:gap-16 items-center">
        <motion.div variants={cascata(0.1, 0.1)} initial="oculto" animate="visivel" className="flex flex-col items-start">
          <motion.p variants={surgir} className="selo-premiacao font-mono text-[11px] sm:text-xs font-medium uppercase tracking-[0.2em]">
            <span aria-hidden="true" className="h-px w-8 bg-current opacity-70" />
            Programa de Premiação voluntária 2026
          </motion.p>

          <TituloHero />

          <motion.div variants={surgir} className="mt-7 max-w-[34rem] border-l border-[#E8D9AE]/40 pl-5">
            <p className={cn(TEXTO_ABERTURA, "font-display font-medium tracking-[-0.01em] text-white")}>
              Shinatal, o reconhecimento de quem faz a shine rio acontecer.
            </p>
            <p className={cn(TEXTO_CORRIDO, "mt-3 text-white/85")}>
              Na shine rio, o ano termina com reconhecimento, gratidão e uma premiação. Durante todo o ano, construímos juntos. No natal, compartilhamos juntos.
            </p>
          </motion.div>

          <motion.div variants={surgir} className="mt-9 flex w-full flex-col items-start gap-4 sm:w-auto">
            <div className="flex w-full gap-3 sm:w-auto">
              <BotaoPilula href="/login" estilo="solido" seta className="flex-1 sm:flex-none sm:min-w-[10.5rem]">Fazer login</BotaoPilula>
              <BotaoPilula href="/cadastro" estilo="vidro" className="flex-1 sm:flex-none sm:min-w-[10.5rem]">Criar cadastro</BotaoPilula>
            </div>
            <a href="#como-funciona" className="link-claro">
              Como funciona o Shinatal
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </a>
          </motion.div>
        </motion.div>

        {/* Card do fundo arrecadado */}
        <motion.div
          initial={{ opacity: 0.01, y: 28, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 1, ease: EASE_BRAND, delay: 0.35 }}
          className="relative w-full max-w-2xl mx-auto"
        >
          <div ref={cardRef} id="card-fundo" className="glass-card-active glow-gold rounded-xl p-10 sm:p-12 relative overflow-hidden w-full min-h-[340px] text-center flex flex-col items-center justify-center">
            <div className="absolute top-0 left-0 right-0 h-1.5" style={{ background: "linear-gradient(90deg, var(--shinatal-red) 0%, var(--shinatal-red) 65%, var(--shinatal-gold) 100%)" }} />
            <p id="fundo-rotulo" className="font-premium text-on-surface-variant mb-5 relative flex items-center justify-center gap-2 text-base sm:text-lg">
              <PiggyBank className="h-5 w-5 text-festive-gold" aria-hidden="true" strokeWidth={1.75} />
              <span id="fundo-rotulo-texto">
                Fundo Shinatal <span className="font-bold text-festive-gold text-lg sm:text-xl">{ano}</span>
              </span>
            </p>

            <div className="relative py-3 w-full flex items-center justify-center">
              <p className="font-display text-gradiente-valor font-bold text-3xl sm:text-4xl md:text-5xl leading-[1.15] relative px-2 sm:whitespace-nowrap">
                {numeros ? (
                  <NumeroAnimado id="valor-arrecadado" valor={numeros.arrecadado} moeda />
                ) : (
                  <span id="valor-arrecadado"><span className="skeleton inline-block w-48 h-12 align-middle rounded-lg" /></span>
                )}
              </p>
            </div>

            <div id="qtd-colaboradores" className="mt-6 relative flex flex-col items-center gap-1">
              <p id="qtd-colaboradores-ano" className="font-body text-body-md text-on-surface-variant flex items-center justify-center gap-2">
                <Users className="h-5 w-5 text-primary" aria-hidden="true" strokeWidth={1.75} />
                {numeros ? (
                  <span>
                    Somos <strong className="valor-colaboradores-destaque"><NumeroAnimado id="num-colaboradores" valor={numeros.colaboradores} /></strong> colaboradores em {ano}
                  </span>
                ) : (
                  <span className="skeleton inline-block w-56 h-5 align-middle rounded" />
                )}
              </p>
              <p id="qtd-colaboradores-total" className="font-body text-label-sm text-on-surface-variant">
                {numeros ? (
                  <>
                    <strong className="valor-colaboradores-destaque"><NumeroAnimado id="num-colaboradores-total" valor={numeros.colaboradores + numeros.anteriores} /></strong> colaboradores no total
                  </>
                ) : (
                  <span className="skeleton inline-block w-32 h-4 align-middle rounded" />
                )}
              </p>
            </div>

            <p className="font-body text-label-sm text-outline mt-6 relative max-w-sm">
              Valor atualizado conforme novos contratos são ativados pela Shine Rio.
            </p>
          </div>

          {/* Chapéu de natal pendurado na quina do card */}
          <motion.img
            initial={{ opacity: 0, y: -10, rotate: 4 }}
            animate={{ opacity: 1, y: 0, rotate: 12 }}
            transition={{ duration: 0.9, ease: EASE_BRAND, delay: 1.1 }}
            src="/assets/chapeu-natal.webp"
            alt=""
            aria-hidden="true"
            width={240}
            height={240}
            className="absolute -top-4 -right-3 sm:-top-8 sm:-right-6 md:-top-10 md:-right-9 w-14 sm:w-16 md:w-20 h-auto z-20 drop-shadow-lg pointer-events-none select-none"
          />
        </motion.div>
      </div>
    </section>
  );
}
