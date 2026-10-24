import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        screen: fileURLToPath(new URL("./index.html", import.meta.url)),
        voice: fileURLToPath(new URL("./voice.html", import.meta.url)),
      },
    },
  },
});
