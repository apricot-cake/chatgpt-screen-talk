import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "node:http";

interface CaptureStatus {
  active: boolean;
  source: string | null;
  frames: number;
  lastFrameAt: string | null;
}

async function captureStatus(
  base: string,
  sessionFetch: typeof fetch,
): Promise<CaptureStatus> {
  const response = await sessionFetch(base + "/status");
  assert.equal(response.status, 200);
  const value: unknown = await response.json();
  assert.ok(typeof value === "object" && value !== null);
  assert.ok("active" in value && typeof value.active === "boolean");
  assert.ok(
    "source" in value &&
      (value.source === null || typeof value.source === "string"),
  );
  assert.ok("frames" in value && typeof value.frames === "number");
  assert.ok(
    "lastFrameAt" in value &&
      (value.lastFrameAt === null || typeof value.lastFrameAt === "string"),
  );
  return {
    active: value.active,
    source: value.source,
    frames: value.frames,
    lastFrameAt: value.lastFrameAt,
  };
}
test(
  "ローカル画面共有の送信元制限・入力検証・開始と停止",
  { timeout: 20000 },
  async (t) => {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), "chatgpt-screen-talk-"),
    );
    const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
    const child = spawn(process.execPath, ["dist/server/server.js"], {
      cwd: repoRoot,
      env: { ...process.env, DATA_DIR: dir, PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let diagnostics = "";
    child.stderr.on("data", (chunk: Buffer) => {
      diagnostics += chunk.toString();
    });
    t.after(async () => {
      child.kill();
      await new Promise<void>((r) => {
        if (child.exitCode !== null || child.signalCode !== null) r();
        else {
          child.once("exit", () => r());
          setTimeout(r, 2000).unref();
        }
      });
      await fs.rm(dir, { recursive: true, force: true });
    });
    const launchUrl = await new Promise<string>((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (b: Buffer) => {
        output += b.toString();
        const url = output
          .split(/\r?\n/)
          .find((line) =>
            /^http:\/\/127\.0\.0\.1:\d+\/#token=[\w-]{43}$/.test(line),
          );
        if (url) resolve(url);
      });
      child.on("error", reject);
      child.on("exit", (code) =>
        reject(Error("server exited: " + code + "\n" + diagnostics)),
      );
    });
    const base = new URL(launchUrl).origin;
    const token = new URLSearchParams(new URL(launchUrl).hash.slice(1)).get(
      "token",
    );
    assert.ok(token);
    const authorization = `Bearer ${token}`;
    const sessionFetch: typeof fetch = (input, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set("Authorization", authorization);
      return fetch(input, { ...init, headers });
    };
    const address = JSON.parse(
      await fs.readFile(path.join(dir, "address.json"), "utf8"),
    );
    assert.equal(address.url, base);
    assert.ok(!JSON.stringify(address).includes(token));
    assert.equal(new URL(base).hostname, "127.0.0.1");
    assert.equal((await fetch(base)).status, 200);
    for (const legacyPath of ["/voice", "/voice.html"]) {
      const legacy = await fetch(base + legacyPath, { redirect: "manual" });
      assert.equal(legacy.status, 302);
      assert.equal(legacy.headers.get("location"), "/");
    }
    assert.match(
      await (await fetch(base + "/voice")).text(),
      /chatgpt-screen-talk/,
    );
    assert.equal((await captureStatus(base, sessionFetch)).active, false);
    // 外部サイトから音声接続や画面の送信を開始できないことを確認する。
    assert.equal(
      (
        await fetch(base + "/voice/start", {
          method: "POST",
          headers: {
            Origin: "https://example.invalid",
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/frame", {
          method: "POST",
          headers: {
            Origin: "https://example.invalid",
            "Content-Type": "image/jpeg",
          },
          body: Buffer.from([255, 216, 255, 217]),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/voice/events", {
          headers: { "Sec-Fetch-Site": "cross-site" },
        })
      ).status,
      403,
    );
    // fetchはHostを書き換えるため、HTTPクライアントで偽装ヘッダーを送る。
    const spoofedHostStatus = await new Promise<number>((resolve, reject) => {
      const req = request(
        base + "/status",
        {
          headers: { Host: "example.invalid" },
          agent: false,
        },
        (response) => {
          response.resume();
          if (response.statusCode === undefined)
            reject(new Error("HTTPステータスがありません"));
          else resolve(response.statusCode);
        },
      );
      req.once("error", reject);
      req.setTimeout(5000, () =>
        req.destroy(new Error("Host検証がタイムアウトしました")),
      );
      req.end();
    });
    assert.equal(spoofedHostStatus, 403);

    // 不正なSDPはCodexを起動する前に拒否する。
    for (const body of [{}, { sdp: 42 }, { sdp: "v=0" + "x".repeat(200000) }]) {
      assert.equal(
        (
          await sessionFetch(base + "/voice/start", {
            method: "POST",
            headers: { Origin: base, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        ).status,
        400,
      );
    }
    assert.equal(
      (
        await sessionFetch(base + "/frame", {
          method: "POST",
          headers: { Origin: base, "Content-Type": "text/plain" },
          body: "x",
        })
      ).status,
      415,
    );
    // Content-Lengthで拒否されることを実HTTPで確認する。
    // 本文を送信しないため、413と大容量uploadのsocket終了が競合しない。
    const oversizedStatus = await new Promise<number>((resolve, reject) => {
      const req = request(
        base + "/frame",
        {
          method: "POST",
          agent: false,
          headers: {
            Origin: base,
            Authorization: authorization,
            "Content-Type": "image/jpeg",
            "Content-Length": 5 * 1024 * 1024 + 1,
            Connection: "close",
          },
        },
        (response) => {
          response.on("error", reject);
          response.on("end", () => {
            resolve(response.statusCode ?? 0);
            req.destroy();
          });
          response.resume();
        },
      );
      req.on("error", reject);
      req.setTimeout(3000, () =>
        req.destroy(new Error("画像サイズ制限の検証がタイムアウトしました")),
      );
      req.flushHeaders();
    });
    assert.equal(oversizedStatus, 413);
    assert.equal((await captureStatus(base, sessionFetch)).active, false);
    const image = new Uint8Array([255, 216, 255, 217]);
    assert.equal(
      (
        await sessionFetch(base + "/frame", {
          method: "POST",
          headers: {
            Origin: base,
            "Content-Type": "image/jpeg",
            "X-Capture-Source": "window",
          },
          body: image,
        })
      ).status,
      200,
    );
    const shared = await captureStatus(base, sessionFetch);
    assert.equal(shared.active, true);
    assert.equal(shared.source, "window");
    assert.equal(shared.frames, 1);
    assert.ok(
      shared.lastFrameAt !== null &&
        Number.isFinite(Date.parse(shared.lastFrameAt)),
    );
    assert.deepEqual(
      new Uint8Array(
        await (await sessionFetch(base + "/latest.jpg")).arrayBuffer(),
      ),
      image,
    );
    assert.equal(
      (
        await sessionFetch(base + "/stop", {
          method: "POST",
          headers: { Origin: base },
        })
      ).status,
      200,
    );
    assert.equal((await captureStatus(base, sessionFetch)).active, false);
    assert.equal((await sessionFetch(base + "/latest.jpg")).status, 404);
  },
);

test(
  "ランチャーの終了通知でHTTPサーバーが正常終了する",
  { timeout: 15000 },
  async (t) => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "chatgpt-screen-talk-ipc-"),
    );
    const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
    const child = spawn(process.execPath, ["dist/server/server.js"], {
      cwd: repoRoot,
      env: { ...process.env, DATA_DIR: directory, PORT: "0" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
    });
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await fs.rm(directory, { recursive: true, force: true });
    });
    assert.ok(child.stdout);
    child.stderr?.resume();
    const origin = await new Promise<string>((resolve, reject) => {
      let output = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const url = output
          .split(/\r?\n/)
          .find((line) =>
            /^http:\/\/127\.0\.0\.1:\d+\/#token=[\w-]{43}$/.test(line),
          );
        if (url) resolve(url);
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        reject(new Error(`起動前に終了しました: ${code}`)),
      );
    });
    assert.equal((await fetch(origin)).status, 200);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("終了通知が処理されませんでした")),
        4000,
      );
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        if (code === 0 && signal === null) resolve();
        else reject(new Error(`異常終了: ${code}/${signal}`));
      });
      child.send({ type: "launcher:shutdown" });
    });
    await assert.rejects(fetch(origin));
  },
);
