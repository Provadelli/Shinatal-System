/** @type {import('tailwindcss').Config} */
module.exports = {
  // app/ é a página inicial em React (Vite). O tailwind.css gerado serve às duas partes do site.
  content: ["./frontend/**/*.html", "./frontend/js/**/*.js", "./app/index.html", "./app/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "on-tertiary-fixed": "#3A2C0E",
        "surface-glass": "rgba(255, 255, 255, 0.85)",
        "surface-container-low": "#F1F0EB",
        "on-primary-fixed-variant": "#123527",
        "error": "#6E2430",
        "on-tertiary": "#ffffff",
        "festive-gold": "#C9A048",
        "natal-vermelho": "#B3262F",
        "natal-pinheiro": "#1E5B43",
        "on-primary-fixed": "#0A2019",
        "surface-container": "#ECEAE4",
        "surface-container-highest": "#DFDDD5",
        "inverse-surface": "#2E2A22",
        "tertiary-fixed-dim": "#D9BE7E",
        "on-background": "#141614",
        "tertiary-container": "#EBDDB8",
        "tertiary": "#7A5C22", // = --shinatal-ouro-texto; #8A6A2F dava 4,33:1 sobre o creme (WCAG 1.4.3 pede 4,5)
        "on-secondary-fixed-variant": "#554730",
        "surface-tint": "#0E3B2E",
        "on-tertiary-fixed-variant": "#6B5321",
        "on-secondary-fixed": "#272116",
        "rio-deep-blue": "#625237",
        "on-surface": "#141614",
        "surface-container-high": "#E6E4DD",
        "primary-container": "#D6E3D9",
        "on-surface-variant": "#5E615C",
        "primary": "#0E3B2E",
        "tertiary-fixed": "#F0E2BE",
        "surface-variant": "#DFDDD5",
        "background": "#F7F6F2",
        "on-secondary-container": "#413725",
        "surface-container-lowest": "#ffffff",
        "on-tertiary-container": "#5C4620",
        "surface": "#F7F6F2",
        "outline": "#64675F",
        "secondary-fixed-dim": "#c8b89d",
        "secondary-fixed": "#e9e3d8",
        "on-error-container": "#5A1620",
        "secondary": "#625237",
        "secondary-container": "#e9e3d8",
        "primary-fixed": "#B9D4C3",
        "on-secondary": "#ffffff",
        "on-primary-container": "#123527",
        "surface-dim": "#D9D6CD",
        "primary-fixed-dim": "#7FAE93",
        "outline-variant": "#E4E1D8",
        "on-primary": "#ffffff",
        "surface-bright": "#F7F6F2",
        "error-container": "#F3DCDD",
        "christmas-red": "#6E2430",
        "on-error": "#ffffff",
        "inverse-on-surface": "#F2F1EC",
        "inverse-primary": "#7FAE93"
      },
      borderRadius: {
        DEFAULT: "0.25rem",
        lg: "0.75rem",
        xl: "1.5rem",
        full: "9999px"
      },
      spacing: {
        "margin-mobile": "16px",
        "margin-desktop": "48px",
        gutter: "24px",
        base: "8px",
        "container-max": "1200px"
      },
      fontFamily: {
        display: ["Space Grotesk", "Inter", "sans-serif"],
        body: ["Inter", "sans-serif"],
        // Fraunces: frases de destaque da página inicial (hero, aberturas de seção, rodapé).
        serif: ["Fraunces", "Georgia", "serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"]
      },
      transitionTimingFunction: {
        brand: "cubic-bezier(0.16, 0.84, 0.32, 1)",
        soft: "cubic-bezier(0.22, 0.68, 0, 1)"
      },
      fontSize: {
        "headline-xl": ["48px", { lineHeight: "56px", letterSpacing: "-0.02em", fontWeight: "700" }],
        "headline-lg": ["32px", { lineHeight: "40px", fontWeight: "600" }],
        "headline-md": ["24px", { lineHeight: "32px", fontWeight: "600" }],
        "body-lg": ["18px", { lineHeight: "28px", fontWeight: "400" }],
        "body-md": ["16px", { lineHeight: "24px", fontWeight: "400" }],
        "label-md": ["14px", { lineHeight: "20px", letterSpacing: "0.05em", fontWeight: "600" }],
        "label-sm": ["12px", { lineHeight: "16px", fontWeight: "500" }],
        "headline-lg-mobile": ["28px", { lineHeight: "36px", fontWeight: "700" }]
      }
    }
  }
};
