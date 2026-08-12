/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/renderer/index.html", "./src/renderer/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        noxara: {
          black: "#0a0a0a",
          void: "#121212",
          surface: "#1a1a1a",
          elevated: "#212121",
          border: "#2a2a2a",
          "border-strong": "#3a3a3a",
          muted: "#6b6b6b",
          subtle: "#9c9c9c",
          text: "#e8e8e8",
          white: "#ffffff",
          success: "#4ade80",
          error: "#f87171",
          warning: "#facc15",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "6px",
        DEFAULT: "8px",
        md: "10px",
        lg: "12px",
        xl: "16px",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(0 0 0 / 0.35)",
        "card-hover": "0 8px 24px -6px rgb(0 0 0 / 0.5)",
        popover: "0 16px 40px -8px rgb(0 0 0 / 0.55)",
      },
      transitionDuration: {
        DEFAULT: "150ms",
      },
      keyframes: {
        "toast-in": {
          "0%": { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "dropdown-in": {
          "0%": { opacity: "0", transform: "translateY(4px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "modal-in": {
          "0%": { opacity: "0", transform: "scale(0.97) translateY(4px)" },
          "100%": { opacity: "1", transform: "scale(1) translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
      },
      animation: {
        "toast-in": "toast-in 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        "dropdown-in": "dropdown-in 150ms cubic-bezier(0.16, 1, 0.3, 1)",
        "fade-in": "fade-in 150ms ease-out",
        "modal-in": "modal-in 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        shimmer: "shimmer 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
