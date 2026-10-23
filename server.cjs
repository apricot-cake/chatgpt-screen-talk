const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const dir = __dirname;
const dataDir = path.resolve(process.env.DATA_DIR || path.join(dir, ".data"));
fs.mkdirSync(dataDir, { recursive: true });
let latest = null;
let status = { frames: 0, lastFrameAt: null, source: null, active: false };
let voice;
function getVoice() {
  return (
    voice ||
    (voice = require("./voice.cjs")({
      getFrame: () =>
        latest && status.active
          ? { bytes: latest, at: status.lastFrameAt }
          : null,
    }))
  );
}
async function jsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 500000) throw Error("要求が大きすぎます");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || "{}");
}
function json(res, value, code = 200) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}
const server = http.createServer((req, res) =>
  handle(req, res).catch((e) => {
    if (!res.headersSent) json(res, { error: e.message }, 500);
    else res.end();
  }),
);
async function handle(req, res) {
  const origin = "http://127.0.0.1:" + server.address().port;
  if (req.headers.host !== new URL(origin).host) {
    res.writeHead(403).end();
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET" && req.url === "/") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(fs.readFileSync(path.join(dir, "index.html")));
    return;
  }
  if (req.method === "GET" && req.url === "/voice") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(fs.readFileSync(path.join(dir, "voice.html")));
    return;
  }
  if (req.method === "GET" && req.url === "/voice/status") {
    json(res, getVoice().status());
    return;
  }
  if (req.method === "GET" && req.url === "/voice/events") {
    if (req.headers["sec-fetch-site"] === "cross-site") {
      res.writeHead(403).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    const unsubscribe = getVoice().subscribe((x) =>
      res.write("data: " + JSON.stringify(x) + "\n\n"),
    );
    const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    return;
  }
  if (req.method === "POST" && req.url.startsWith("/voice/")) {
    if (req.headers.origin !== origin) {
      json(res, { error: "許可されていない送信元です" }, 403);
      return;
    }
    const body = await jsonBody(req);
    if (req.url === "/voice/start") {
      if (typeof body.sdp !== "string") {
        json(res, { error: "接続情報がありません" }, 400);
        return;
      }
      json(res, await getVoice().start(body.sdp));
      return;
    }
    if (req.url === "/voice/stop") {
      await getVoice().stop();
      json(res, { ok: true });
      return;
    }
    if (req.url === "/voice/diagnostics") {
      fs.writeFileSync(
        path.join(dataDir, "voice-diagnostics.json"),
        JSON.stringify(body, null, 2),
      );
      json(res, { ok: true });
      return;
    }
  }
  if (req.method === "GET" && req.url === "/status") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(status));
    return;
  }
  if (
    req.method === "GET" &&
    req.url === "/latest.jpg" &&
    latest &&
    status.active
  ) {
    res.setHeader("Content-Type", "image/jpeg");
    res.end(latest);
    return;
  }
  if (
    req.method === "POST" &&
    req.headers.origin === origin &&
    ["/frame", "/stop"].includes(req.url)
  ) {
    if (req.url === "/stop") {
      status.active = false;
      fs.writeFileSync(
        path.join(dataDir, "status.json"),
        JSON.stringify(status, null, 2),
      );
      res.end("ok");
      return;
    }
    if (req.headers["content-type"] !== "image/jpeg") {
      res.writeHead(415).end();
      return;
    }
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 5 * 1024 * 1024) {
        res.writeHead(413).end();
        return;
      }
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (bytes[0] !== 255 || bytes[1] !== 216) {
      res.writeHead(400).end();
      return;
    }
    latest = bytes;
    status = {
      frames: status.frames + 1,
      lastFrameAt: new Date().toISOString(),
      source: String(req.headers["x-capture-source"] || "selected-window"),
      active: true,
    };
    fs.writeFileSync(path.join(dataDir, "latest.jpg"), latest);
    fs.writeFileSync(
      path.join(dataDir, "status.json"),
      JSON.stringify(status, null, 2),
    );
    res.end("ok");
    return;
  }
  res.writeHead(404).end();
}
server.listen(
  Number(process.argv[2] || process.env.PORT || 0),
  "127.0.0.1",
  () => {
    const url = "http://127.0.0.1:" + server.address().port;
    fs.writeFileSync(
      path.join(dataDir, "address.json"),
      JSON.stringify({ url, pid: process.pid }),
    );
    console.log(url);
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await voice?.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
