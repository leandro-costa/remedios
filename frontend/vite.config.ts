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
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
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
        background_color: "#f6f7f9",
        theme_color: "#1f6f5c",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // O app abre sem internet; os dados offline ficam no IndexedDB, não no cache HTTP.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/q\//],
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
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
