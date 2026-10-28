/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// A API fica na mesma origem: em produção o nginx do compose repassa /api;
// em desenvolvimento, o proxy do Vite.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const authMode = env.VITE_AUTH_MODE === "local" ? "local" : "firebase";
  return {
  // Constante no build: o código do modo local (com a chave de teste) só entra
  // no pacote quando VITE_AUTH_MODE=local.
  define: { __AUTH_MODE__: JSON.stringify(authMode) },
  // Fontes nunca viram data: URI, que a CSP (font-src 'self') bloqueia.
  build: { assetsInlineLimit: (file: string) => (file.endsWith(".woff2") ? false : undefined) },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Service worker próprio (src/sw.ts): precache + avisos de push.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: { globPatterns: ["**/*.{js,css,html,svg,png,woff2}"] },
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Remédios da Família",
        short_name: "Remédios",
        description: "Agenda e registro de medicamentos da família.",
        lang: "pt-BR",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#f3f6f5",
        theme_color: "#0e2a33",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8080" },
    fs: { allow: [".", "../backend/src/test/resources"] },
  },
  preview: {
    port: 4173,
    proxy: { "/api": "http://localhost:8080" },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
  };
});
