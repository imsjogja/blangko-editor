import devServer from "@hono/vite-dev-server"
import path from "path"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    {
      name: "kimi-preview-host",
      config(config) {
        const hosts = config.server?.allowedHosts;
        if (hosts === true || hosts?.includes("3000.proxy.internal")) return;
        return { server: { allowedHosts: ["3000.proxy.internal"] } };
      },
    },
    devServer({ entry: "api/boot.ts", exclude: [/^\/(?!api\/).*$/] }),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon-192.png", "icons/icon-512.png"],
      manifest: {
        name: "Blangko Editor",
        short_name: "Blangko",
        description: "Editor layout blangko undangan siap cetak.",
        theme_color: "#191817",
        background_color: "#191817",
        display: "standalone",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,png,woff2}"],
        runtimeCaching: [{ urlPattern: ({ request }) => request.mode === "navigate", handler: "NetworkOnly" }],
      },
    }),
    inspectAttr(), react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "@db": path.resolve(__dirname, "./db"),
      "db": path.resolve(__dirname, "./db"),
    },
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
});
