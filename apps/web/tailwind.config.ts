import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        theme: {
          base: "var(--bg-base)",
          surface: "var(--bg-surface)",
          subtle: "var(--bg-subtle)",
          card: "var(--bg-card)",
          hover: "var(--bg-hover)",
          active: "var(--bg-active)",
          border: "var(--border-subtle)",
          borderDefault: "var(--border-default)",
          text: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
          accent: "var(--accent)",
          accentHover: "var(--accent-hover)",
          accentLight: "var(--accent-light)",
        },
        nebula: {
          950: "var(--bg-base)",
          900: "var(--bg-surface)",
          850: "var(--bg-subtle)",
          800: "var(--bg-hover)",
          700: "var(--border-default)",
          600: "var(--border-subtle)",
          accent: "var(--accent)",
          accentHover: "var(--accent-hover)",
          cyan: "#06b6d4",
          violet: "#8b5cf6",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "-apple-system", "BlinkMacSystemFont", "'Segoe UI'", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
