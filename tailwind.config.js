/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./frontend/**/*.html", "./frontend/js/**/*.js"],
  theme: {
    extend: {
      colors: {
        "on-tertiary-fixed": "#3A2C0E",
        "surface-glass": "rgba(255, 255, 255, 0.85)",
        "surface-container-low": "#F6F1E4",
        "on-primary-fixed-variant": "#123527",
        "error": "#6E2430",
        "on-tertiary": "#ffffff",
        "festive-gold": "#B08D2F",
        "on-primary-fixed": "#0A2019",
        "surface-container": "#F0E9D8",
        "surface-container-highest": "#E7DCC0",
        "inverse-surface": "#2E2A22",
        "tertiary-fixed-dim": "#D9BE7E",
        "on-background": "#23201B",
        "tertiary-container": "#EBDDB8",
        "tertiary": "#8A6A2F",
        "on-secondary-fixed-variant": "#554730",
        "surface-tint": "#0E3B2E",
        "on-tertiary-fixed-variant": "#6B5321",
        "on-secondary-fixed": "#272116",
        "rio-deep-blue": "#625237",
        "on-surface": "#23201B",
        "surface-container-high": "#ECE3CC",
        "primary-container": "#D6E3D9",
        "on-surface-variant": "#5C5344",
        "primary": "#0E3B2E",
        "tertiary-fixed": "#F0E2BE",
        "surface-variant": "#E7DCC0",
        "background": "#FAF6EE",
        "on-secondary-container": "#413725",
        "surface-container-lowest": "#ffffff",
        "on-tertiary-container": "#5C4620",
        "surface": "#FAF6EE",
        "outline": "#8A7F68",
        "secondary-fixed-dim": "#c8b89d",
        "secondary-fixed": "#e9e3d8",
        "on-error-container": "#5A1620",
        "secondary": "#625237",
        "secondary-container": "#e9e3d8",
        "primary-fixed": "#B9D4C3",
        "on-secondary": "#ffffff",
        "on-primary-container": "#123527",
        "surface-dim": "#E4D8BA",
        "primary-fixed-dim": "#7FAE93",
        "outline-variant": "#DCD0B4",
        "on-primary": "#ffffff",
        "surface-bright": "#FAF6EE",
        "error-container": "#F3DCDD",
        "christmas-red": "#6E2430",
        "on-error": "#ffffff",
        "inverse-on-surface": "#F5EFDF",
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
        display: ["Playfair Display", "serif"],
        body: ["Inter", "sans-serif"]
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
