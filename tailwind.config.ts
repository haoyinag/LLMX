import type { Config } from 'tailwindcss';

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: {
          50: "#f6f7fb",
          900: "#111827"
        }
      }
    }
  },
  plugins: []
};

export default config;
