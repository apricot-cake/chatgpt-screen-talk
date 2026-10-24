import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";

const appRoot = fileURLToPath(new URL("../../", import.meta.url));
const dataDir = path.resolve(
  process.env.DATA_DIR || path.join(appRoot, ".data"),
);
const app = await createApp({ dataDir });
try {
  const url = await app.listen({
    port: Number(process.argv[2] || process.env.PORT || 0),
    host: "127.0.0.1",
  });
  fs.writeFileSync(
    path.join(dataDir, "address.json"),
    JSON.stringify({ url, pid: process.pid }),
  );
  console.log(url);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    const timeout = setTimeout(() => process.exit(0), 6000);
    timeout.unref();
    void app.close().then(() => {
      clearTimeout(timeout);
    });
  });
}
