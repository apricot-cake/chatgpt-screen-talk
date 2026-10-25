import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/server/app.js";
import { createLocalAuth } from "../src/server/local-auth.js";
import type { VoiceService, VoiceStatus } from "../src/server/voice.js";
import { EventSource } from "eventsource";

test("全APIは起動ごとのBearer認証を要求し、符号化・HEAD・Cookieでは迂回できない", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "screen-talk-auth-"),
  );
  let starts = 0;
  let stops = 0;
  let subscriptions = 0;
  let state: VoiceStatus["state"] = "stopped";
  const status = (): VoiceStatus => ({
    state,
    lastError: null,
    toolsEnabled: true,
    auth: "chatgpt",
    limits: null,
  });
  const voice: VoiceService = {
    status,
    start: async () => {
      starts++;
      state = "active";
      return { sdp: "v=0\r\n", ...status() };
    },
    stop: async () => {
      stops++;
      state = "stopped";
      return status();
    },
    subscribe: () => {
      subscriptions++;
      return () => {};
    },
  };
  const auth = createLocalAuth();
  const foreign = createLocalAuth();
  assert.notEqual(auth.token, foreign.token);
  const app = await createApp({
    dataDir: directory,
    voice,
    auth,
    clientDir: fileURLToPath(new URL("../../dist/client", import.meta.url)),
  });
  t.after(async () => {
    app.server.closeAllConnections();
    await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  const authorization = `Bearer ${auth.token}`;
  const headers = { Authorization: authorization, Origin: origin };
  const image = new Uint8Array([255, 216, 255, 217]);
  assert.equal(
    (
      await fetch(origin + "/frame", {
        method: "POST",
        headers: { ...headers, "Content-Type": "image/jpeg" },
        body: image,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(origin + "/voice/start", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ sdp: "v=0\r\n" }),
      })
    ).status,
    200,
  );
  const getPaths = [
    "/status",
    "/latest.jpg",
    "/voice/status",
    "/voice/events",
    "/%73tatus",
    "/latest%2ejpg",
    "/voice/%73tatus",
    "/voice/%65vents?x=1",
  ];
  const postPaths = [
    "/frame",
    "/stop",
    "/voice/start",
    "/voice/stop",
    "/voice/diagnostics",
    "/%66rame",
    "/%73top",
    "/voice/%73tart",
    "/voice/%73top",
    "/voice/%64iagnostics",
  ];
  const invalidCredentials: Record<string, string>[] = [
    {},
    { Authorization: "Bearer invalid" },
    { Authorization: `Bearer ${foreign.token}` },
    { Cookie: `token=${auth.token}` },
  ];
  for (const invalidHeaders of invalidCredentials) {
    for (const endpoint of getPaths) {
      for (const method of ["GET", "HEAD"]) {
        const response = await fetch(origin + endpoint, {
          method,
          headers: invalidHeaders,
        });
        assert.equal(response.status, 401, `${method} ${endpoint}`);
        assert.match(
          response.headers.get("www-authenticate") ?? "",
          /^Bearer /,
        );
        assert.ok(!(await response.text()).includes(auth.token));
      }
    }
    for (const endpoint of postPaths) {
      assert.equal(
        (
          await fetch(origin + endpoint, {
            method: "POST",
            headers: {
              ...invalidHeaders,
              Origin: origin,
              "Content-Type": "application/json",
            },
            body: "{}",
          })
        ).status,
        401,
        endpoint,
      );
    }
  }
  assert.equal(
    (await fetch(`${origin}/status?token=${auth.token}`)).status,
    401,
  );
  assert.equal(starts, 1);
  assert.equal(stops, 0);
  assert.equal(subscriptions, 0);
  assert.deepEqual(
    new Uint8Array(await fs.readFile(path.join(directory, "latest.jpg"))),
    image,
  );
  await assert.rejects(fs.stat(path.join(directory, "voice-diagnostics.json")));
  const shared = await (await fetch(origin + "/status", { headers })).json();
  assert.equal(shared.active, true);
  assert.equal(shared.frames, 1);
  assert.deepEqual(
    new Uint8Array(
      await (await fetch(origin + "/latest.jpg", { headers })).arrayBuffer(),
    ),
    image,
  );
  assert.equal((await fetch(origin + "/%73tatus", { headers })).status, 200);
  assert.equal(
    (
      await fetch(origin + "/voice/%65vents", {
        headers: { ...headers, Origin: "https://example.invalid" },
      })
    ).status,
    403,
  );

  // ブラウザと同じ EventSource 実装で認証付き購読と再購読を通す。
  for (let i = 0; i < 2; i++) {
    const events = new EventSource(origin + "/voice/events", {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init?.headers)),
            Authorization: authorization,
          },
        }),
    });
    try {
      const event = await new Promise<MessageEvent<string>>(
        (resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("音声イベントが届きませんでした")),
            3000,
          );
          events.onmessage = (value) => {
            clearTimeout(timer);
            resolve(value);
          };
          events.onerror = () => {
            clearTimeout(timer);
            reject(new Error("音声イベントに接続できませんでした"));
          };
        },
      );
      assert.equal(JSON.parse(event.data).state, "active");
    } finally {
      events.close();
    }
  }
  assert.equal(subscriptions, 2);
  assert.equal(
    (
      await fetch(origin + "/voice/diagnostics", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          connection: "connected",
          remoteTrack: [],
          inbound: null,
          audioPaused: false,
          audioTime: 1,
        }),
      })
    ).status,
    200,
  );
  assert.equal(
    (await fetch(origin + "/voice/stop", { method: "POST", headers })).status,
    200,
  );
  assert.equal(
    (await (await fetch(origin + "/status", { headers })).json()).active,
    true,
  );
  assert.equal(stops, 1);
  assert.equal(
    (await fetch(origin + "/stop", { method: "POST", headers })).status,
    200,
  );
  assert.equal((await fetch(origin + "/latest.jpg", { headers })).status, 404);
  const publicHtml = await fetch(origin);
  assert.equal(publicHtml.status, 200);
  assert.ok(!(await publicHtml.text()).includes(auth.token));
});

test(
  "音声イベントの接続中でもサーバー終了時に音声を停止し購読を解除する",
  { timeout: 10000 },
  async (t) => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "chatgpt-screen-talk-close-"),
    );
    let stops = 0;
    let unsubscribes = 0;
    let subscribed: () => void = () => {};
    const subscriptionReady = new Promise<void>((resolve) => {
      subscribed = resolve;
    });
    const status = (): VoiceStatus => ({
      state: "active",
      lastError: null,
      toolsEnabled: true,
      auth: "chatgpt",
      limits: null,
    });
    const voice: VoiceService = {
      status,
      start: async () => ({ sdp: "v=0\r\n", ...status() }),
      stop: async () => {
        stops++;
        return { ...status(), state: "stopped" };
      },
      subscribe: () => {
        subscribed();
        return () => {
          unsubscribes++;
        };
      },
    };
    const auth = createLocalAuth();
    const app = await createApp({ voice, dataDir: directory, auth });
    const controller = new AbortController();
    t.after(async () => {
      controller.abort();
      app.server.closeAllConnections();
      await app.close();
      await fs.rm(directory, { recursive: true, force: true });
    });
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    assert.equal(
      (
        await fetch(origin + "/voice/events?x=1", {
          headers: {
            Origin: "https://example.invalid",
            "Sec-Fetch-Site": "cross-site",
          },
        })
      ).status,
      403,
    );
    const response = await fetch(origin + "/voice/events", {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type") ?? "",
      /^text\/event-stream/,
    );
    assert.ok(response.body);
    const reader = response.body.getReader();
    const firstEvent = await reader.read();
    assert.match(new TextDecoder().decode(firstEvent.value), /"type":"status"/);
    await subscriptionReady;
    const closed = await Promise.race([
      app.close().then(() => true),
      delay(2000, false),
    ]);
    assert.equal(
      closed,
      true,
      "SSEを開いたクライアントを待たずに終了できること",
    );
    assert.equal(stops, 1);
    assert.equal(unsubscribes, 1);
    assert.equal((await reader.read()).done, true);
  },
);
