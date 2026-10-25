import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { createLocalAuth } from "./local-auth.js";

const appRoot = fileURLToPath(new URL("../../", import.meta.url));
const dataDir = path.resolve(
  process.env.DATA_DIR || path.join(appRoot, ".data"),
);
const auth = createLocalAuth();
const app = await createApp({ dataDir, auth });
try {
  const url = await app.listen({
    port: Number(process.argv[2] || process.env.PORT || 0),
    host: "127.0.0.1",
  });
  fs.writeFileSync(
    path.join(dataDir, "address.json"),
    JSON.stringify({ url, pid: process.pid }),
  );
  console.log(`${url}/#token=${auth.token}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

let closing = false;
function shutdown(): void {
  if (closing) return;
  closing = true;
  const timeout = setTimeout(() => process.exit(0), 6000);
  timeout.unref();
  const finish = () => {
    clearTimeout(timeout);
    if (process.connected) process.disconnect();
  };
  void app.close().then(finish, (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    finish();
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, shutdown);
}

if (process.connected) {
  process.on("message", (message: unknown) => {
    if (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      message.type === "launcher:shutdown"
    )
      shutdown();
  });
}
