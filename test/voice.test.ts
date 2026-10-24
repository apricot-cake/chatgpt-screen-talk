import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import createVoice, {
  type VoiceService,
  type VoiceEvent,
} from "../src/server/voice.js";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
  );
  return value as JsonRecord;
}

interface MockOptions {
  accountType?: string;
  unsupportedOptionalFields?: boolean;
}

async function withMock(
  options: MockOptions,
  run: (
    voice: VoiceService,
    readLog: () => Promise<JsonRecord[]>,
  ) => Promise<void>,
): Promise<void> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "chatgpt-screen-talk-voice-"),
  );
  const executable = path.join(directory, "codex.js");
  const logPath = path.join(directory, "protocol.jsonl");
  const keys = [
    "CODEX_BIN",
    "OPENAI_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "CODEX_API_KEY",
  ] as const;
  const originalEnvironment = new Map(
    keys.map((key) => [key, process.env[key]]),
  );
  const voice = createVoice({
    cwd: directory,
    getFrame: () => ({
      bytes: Buffer.from([255, 216, 255, 217]),
      at: "2026-10-24T00:00:00.000Z",
    }),
  });
  try {
    await fs.writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ type: "commonjs" }),
    );
    await fs.writeFile(
      executable,
      `
const fs = require("node:fs");
const readline = require("node:readline");
const options = ${JSON.stringify(options)};
const logPath = ${JSON.stringify(logPath)};
const log = (value) => fs.appendFileSync(logPath, JSON.stringify(value) + "\\n");
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
log({ event: "environment", platformKeysPresent: ["OPENAI_API_KEY", "AZURE_OPENAI_API_KEY", "CODEX_API_KEY"].some((key) => key in process.env) });
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  log(message);
  const result = (value) => send({ id: message.id, result: value });
  if (message.method === "initialize") result({});
  else if (message.method === "account/read") result({ account: { type: options.accountType || "chatgpt" } });
  else if (message.method === "account/rateLimits/read") result({ ordinaryUsageAllowed: true, rateLimits: { primary: { usedPercent: 12 } } });
  else if (message.method === "thread/start") {
    if (options.unsupportedOptionalFields && message.params.dynamicTools) send({ id: message.id, error: { code: -32602, message: "unsupported dynamicTools" } });
    else result({ thread: { id: "test-thread" } });
  } else if (message.method === "thread/realtime/start") {
    if (options.unsupportedOptionalFields && message.params.initialItems) {
      send({ id: message.id, error: { code: -32602, message: "unsupported initialItems" } });
      return;
    }
    result({});
    send({ method: "thread/realtime/sdp", params: { sdp: "v=0\\r\\ns=mock-answer\\r\\n" } });
    if (!options.unsupportedOptionalFields) send({ id: "screen-request", method: "item/tool/call", params: { name: "get_shared_screen", arguments: {} } });
  } else if (message.method === "thread/realtime/stop") result({});
});
`,
    );
    process.env.CODEX_BIN = executable;
    for (const key of keys.slice(1)) process.env[key] = "test-only-api-key";
    const readLog = async (): Promise<JsonRecord[]> => {
      const text = await fs.readFile(logPath, "utf8");
      return text
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => record(JSON.parse(line) as unknown));
    };
    await run(voice, readLog);
  } finally {
    await voice.stop();
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function waitForLog(
  readLog: () => Promise<JsonRecord[]>,
  predicate: (entry: JsonRecord) => boolean,
): Promise<JsonRecord[]> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const entries = await readLog();
    if (entries.some(predicate)) return entries;
    await delay(10);
  }
  throw new Error("mock Codexへの要求が完了しませんでした");
}

test(
  "ChatGPT認証で画面付き音声接続を開始・終了し、APIキーを渡さない",
  { concurrency: false, timeout: 15000 },
  async () => {
    await withMock({}, async (voice, readLog) => {
      const events: VoiceEvent[] = [];
      const unsubscribe = voice.subscribe((event) => events.push(event));
      const result = await voice.start("v=0\r\ns=mock-offer\r\n");
      assert.equal(result.state, "active");
      assert.equal(result.auth, "chatgpt");
      assert.equal(result.toolsEnabled, true);
      assert.match(result.sdp, /^v=0/);
      await assert.rejects(voice.start("v=0\r\n"), /すでに開始/);

      const entries = await waitForLog(
        readLog,
        (entry) => entry.id === "screen-request",
      );
      assert.equal(
        entries.find((entry) => entry.event === "environment")
          ?.platformKeysPresent,
        false,
      );
      const threadRequest = entries.find(
        (entry) => entry.method === "thread/start",
      );
      const threadParams = record(threadRequest?.params);
      assert.equal(threadParams.cwd, path.dirname(process.env.CODEX_BIN ?? ""));
      assert.equal(threadParams.sandbox, "read-only");
      assert.equal(threadParams.approvalPolicy, "never");
      assert.ok(Array.isArray(threadParams.dynamicTools));
      assert.equal(
        record(threadParams.dynamicTools[0]).name,
        "get_shared_screen",
      );
      const realtimeRequest = entries.find(
        (entry) => entry.method === "thread/realtime/start",
      );
      const realtimeParams = record(realtimeRequest?.params);
      assert.equal(realtimeParams.version, "v3");
      assert.equal(realtimeParams.outputModality, "audio");
      assert.equal(record(realtimeParams.transport).type, "webrtc");

      const frameResult = record(
        entries.find((entry) => entry.id === "screen-request")?.result,
      );
      assert.equal(frameResult.success, true);
      assert.ok(Array.isArray(frameResult.contentItems));
      const image = frameResult.contentItems
        .map((value: unknown) => record(value))
        .find((item) => item.type === "inputImage");
      assert.equal(image?.imageUrl, "data:image/jpeg;base64,/9j/2Q==");
      assert.ok(events.some((event) => event.type === "screen_read"));
      assert.equal((await voice.stop()).state, "stopped");
      assert.equal(voice.status().auth, null);
      assert.ok(
        (await readLog()).some(
          (entry) => entry.method === "thread/realtime/stop",
        ),
      );
      unsubscribe();
    });
  },
);

test(
  "API認証では接続を開始せずChatGPTログインを要求する",
  { concurrency: false, timeout: 15000 },
  async () => {
    await withMock({ accountType: "apiKey" }, async (voice, readLog) => {
      await assert.rejects(voice.start("v=0\r\n"), /ChatGPTログインが必要/);
      assert.equal(voice.status().state, "stopped");
      assert.equal(voice.status().auth, null);
      const entries = await readLog();
      assert.equal(
        entries.some((entry) => entry.method === "thread/start"),
        false,
      );
      assert.equal(
        entries.some((entry) => entry.method === "thread/realtime/start"),
        false,
      );
    });
  },
);

test(
  "古いCodexが任意フィールドを拒否した場合は画面なしの音声へ切り替える",
  { concurrency: false, timeout: 15000 },
  async () => {
    await withMock(
      { unsupportedOptionalFields: true },
      async (voice, readLog) => {
        const events: VoiceEvent[] = [];
        voice.subscribe((event) => events.push(event));
        const result = await voice.start("v=0\r\n");
        assert.equal(result.state, "active");
        assert.equal(result.toolsEnabled, false);
        assert.ok(
          events.some(
            (event) =>
              event.type === "warning" && /音声のみ/.test(event.message),
          ),
        );
        const entries = await readLog();
        const realtimeRequests = entries.filter(
          (entry) => entry.method === "thread/realtime/start",
        );
        assert.equal(realtimeRequests.length, 2);
        assert.equal(
          "initialItems" in record(realtimeRequests[1]?.params),
          false,
        );
        assert.equal((await voice.stop()).state, "stopped");
      },
    );
  },
);
