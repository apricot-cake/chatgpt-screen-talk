const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
test(
  "ローカル画面共有の送信元制限と開始・停止",
  { timeout: 20000 },
  async (t) => {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), "chatgpt-screen-talk-"),
    );
    const child = spawn(process.execPath, ["server.cjs"], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, DATA_DIR: dir },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    t.after(async () => {
      child.kill();
      await new Promise((r) => {
        if (child.exitCode !== null) r();
        else {
          child.once("exit", r);
          setTimeout(r, 2000).unref();
        }
      });
      await fs.rm(dir, { recursive: true, force: true });
    });
    const base = await new Promise((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (b) => {
        output += b;
        if (output.includes("\n")) resolve(output.trim().split("\n")[0]);
      });
      child.on("error", reject);
      child.on("exit", (code) => reject(Error("server exited: " + code)));
    });
    assert.equal(new URL(base).hostname, "127.0.0.1");
    assert.equal((await fetch(base)).status, 200);
    assert.match(await (await fetch(base + "/voice")).text(), /chatgpt-screen-talk/);
    assert.equal((await (await fetch(base + "/status")).json()).active, false);
    // A foreign web page must not start a microphone/backend session.
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
      404,
    );
    assert.equal(
      (
        await fetch(base + "/frame", {
          method: "POST",
          headers: { Origin: base, "Content-Type": "text/plain" },
          body: "x",
        })
      ).status,
      415,
    );
    const image = Buffer.from([255, 216, 255, 217]);
    assert.equal(
      (
        await fetch(base + "/frame", {
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
    const shared = await (await fetch(base + "/status")).json();
    assert.equal(shared.active, true);
    assert.equal(shared.source, "window");
    assert.deepEqual(
      Buffer.from(await (await fetch(base + "/latest.jpg")).arrayBuffer()),
      image,
    );
    assert.equal(
      (
        await fetch(base + "/stop", {
          method: "POST",
          headers: { Origin: base },
        })
      ).status,
      200,
    );
    assert.equal((await (await fetch(base + "/status")).json()).active, false);
    assert.equal((await fetch(base + "/latest.jpg")).status, 404);
  },
);
