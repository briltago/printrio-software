import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Licences of the bundled third-party code, served as /third-party-licenses.md (AGPL notices).
  build: { license: { fileName: "third-party-licenses.md" } },
  server: {
    port: 5173,
    // ws: live printer status (/api/ws) goes through the proxy too.
    proxy: { "/api": { target: "http://localhost:3000", ws: true } },
  },
});
