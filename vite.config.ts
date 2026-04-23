import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

function corsMiddleware() {
  return {
    name: "cors-middleware",
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    corsMiddleware(),
    reactRouter(),
    tsconfigPaths(),
  ],
  build: {
    assetsInlineLimit: 0,
  },
  server: {
    port: 3000,
    allowedHosts: true,
    warmup: {
      clientFiles: ["./app/entry.client.tsx"],
      ssrFiles: ["./app/entry.server.tsx"],
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom"],
  },
});
