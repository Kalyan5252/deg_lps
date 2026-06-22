import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#16181d",
        sub: "#6b7280",
        line: "#e7e8ec",
        panel: "#ffffff",
        canvas: "#f7f8fa",
        accent: "#2f6df6",
        ok: "#16a34a",
        warn: "#d97706",
        bad: "#dc2626",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
