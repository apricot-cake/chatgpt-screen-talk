import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "../src/server/app.js";
import type { VoiceService, VoiceStatus } from "../src/server/voice.js";

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
    const app = await createApp({ voice, dataDir: directory });
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
