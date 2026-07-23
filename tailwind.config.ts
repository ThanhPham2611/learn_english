import type { Config } from "tailwindcss";

// Map design token (CSS var) -> class Tailwind, để dùng bg-primary, text-muted...
const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        border: "var(--border)",
        text: "var(--text)",
        muted: "var(--muted)",
        primary: {
          DEFAULT: "var(--primary)",
          dark: "var(--primary-dark)",
        },
        accent: "var(--accent)",
        userbubble: "var(--user-bubble)",
        "primary-text": "var(--primary-text)",
        "accent-text": "var(--accent-text)",
      },
      fontFamily: {
        heading: ["var(--font-heading)", "Georgia", "serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
