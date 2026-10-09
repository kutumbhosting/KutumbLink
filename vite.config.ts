import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

export default defineConfig(({ mode }) => ({
  build: {
    // Keep production bundles at the dist root; dist/assets is intentionally
    // omitted from the distributable package.
    assetsDir: "",
  },
  server: {
    host: "::",
    port: 8080,
    proxy: {
      // ✅ API
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },

      // ✅ static folders from backend
      "/eventflyer": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
      "/pastevents": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
      "/pastmedia": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
      "/team-images": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
"/activity-images": {
  target: "http://localhost:5000",
  changeOrigin: true,
  secure: false,
},
    },
  },

  plugins: [
    react(),
    mode === "development" && componentTagger(),
  ].filter(Boolean),

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
