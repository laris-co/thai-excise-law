import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// dev server proxies /api to the Python server; both stay on 127.0.0.1
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 5179, proxy: { "/api": "http://127.0.0.1:8796" } },
});
