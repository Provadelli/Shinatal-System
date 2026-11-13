// m (não motion): com LazyMotion no App, o motor de animação carrega à parte, fora do pacote inicial.
import { m as motion } from "framer-motion";
import { BotaoContorno } from "@/components/ui/botao-contorno";
import { EASE_BRAND } from "@/lib/movimento";

const LINKS = [
  { href: "#sobre-nos", rotulo: "Quem somos" },
  { href: "#sobre-shinatal", rotulo: "Sobre" },
  { href: "#como-funciona", rotulo: "Como funciona" },
  { href: "#nossos-valores", rotulo: "Valores" }
];

const entrada = {
  initial: { opacity: 0, y: -12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.8, ease: EASE_BRAND, delay: 0.3 }
};

// Transparente sobre o vídeo, bege com fio dourado ao rolar (classe header-transparente, trocada
// no App). Os botões têm fundo próprio, então não mudam de cor entre os dois estados.
// O menu do celular é ligado por js/acessibilidade.js ([data-menu-alternar]).
export function Cabecalho() {
  return (
    <>
      <motion.nav {...entrada} aria-label="Principal" className="header-flutuante header-home header-transparente hidden md:flex">
        <div className="w-full max-w-container-max mx-auto px-margin-desktop min-h-14 flex items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-2.5 shrink-0">
            <span className="flex flex-col items-start leading-none gap-1">
              <img src="/assets/logoshinatal-cropped.webp" width={320} height={121} alt="Shinatal, página inicial" className="logo-vermelho h-8 w-auto" />
              <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-on-surface-variant">Shine Rio Group</span>
            </span>
          </a>

          <div className="flex-1 min-w-0 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 lg:gap-x-9">
            {LINKS.map((link) => (
              <a key={link.href} href={link.href} className="nav-link nav-link-tecnico py-1 whitespace-nowrap shrink-0">
                {link.rotulo}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <BotaoContorno href="/login" tom="verde" tamanho="compacto">Login</BotaoContorno>
            <BotaoContorno href="/cadastro" tom="vinho" tamanho="compacto" seta>Cadastro</BotaoContorno>
          </div>
        </div>
      </motion.nav>

      <motion.header {...entrada} className="header-flutuante header-home header-transparente md:hidden">
        <div className="max-w-container-max mx-auto px-margin-mobile min-h-12 flex items-center justify-between gap-3">
          <a href="/" className="flex items-center gap-2.5 shrink-0">
            <span className="flex flex-col items-start leading-none gap-1">
              <img src="/assets/logoshinatal-cropped.webp" width={320} height={121} alt="Shinatal, página inicial" className="logo-vermelho h-7 w-auto" />
              <span className="font-mono text-[8px] uppercase tracking-[0.22em] text-on-surface-variant">Shine Rio Group</span>
            </span>
          </a>

          <div className="flex items-center gap-1.5 shrink-0">
            <BotaoContorno href="/login" tom="verde" tamanho="compacto">Entrar</BotaoContorno>
            <BotaoContorno href="/cadastro" tom="vinho" tamanho="compacto" seta>Cadastro</BotaoContorno>
            <button type="button" data-menu-alternar aria-expanded="false" aria-controls="menu-celular" className="btn-fantasma !border-0 !py-1.5 !px-2.5 text-sm">
              Menu
            </button>
          </div>
        </div>
        <nav id="menu-celular" aria-label="Principal" className="menu-celular" hidden>
          {LINKS.map((link) => (
            <a key={link.href} href={link.href}>{link.rotulo}</a>
          ))}
        </nav>
      </motion.header>
    </>
  );
}
