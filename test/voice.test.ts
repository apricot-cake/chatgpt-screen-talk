import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import createVoice, {
  type VoiceService,
  type VoiceEvent,
  type SharedFrame,
} from "../src/server/voice.js";
import { SUPPORTED_CODEX_VERSION } from "../src/server/voice-security.js";

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
  stateRuntimeFailure?: boolean;
  version?: string;
  unsafeConfig?: boolean;
  configUnavailable?: boolean;
  unsupportedInitialItems?: boolean;
  mcpNames?: string[];
  toolName?: string;
  configChanged?: boolean;
}

async function withMock(
  options: MockOptions,
  run: (
    voice: VoiceService,
    readLog: () => Promise<JsonRecord[]>,
  ) => Promise<void>,
  getFrame?: () => SharedFrame | null | Promise<SharedFrame | null>,
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
    getFrame: getFrame ?? (() => ({
      bytes: Buffer.from([255, 216, 255, 217]),
      at: "2026-10-24T00:00:00.000Z",
    })),
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
const args = process.argv.slice(2);
log({ event: "command", args });
if (args[0] === "--version") {
  console.log("codex-cli " + (options.version || ${JSON.stringify(SUPPORTED_CODEX_VERSION)}));
  process.exit(0);
}
if (args[0] === "features") {
  console.log(["shell_tool", "view_image", "multi_agent", "plugins", "hooks", "apps", "goals", "code_mode", "computer_use", "browser_use", "skill_search", "unified_exec", "new_future_capability"].map(name => name + " stable true").join("\\n"));
  process.exit(0);
}
const config = {};
for (let index = 0; index < args.length; index++) {
  if (args[index] !== "--config") continue;
  const option = args[++index], split = option.indexOf("=");
  const keys = option.slice(0, split).split(".");
  let target = config;
  for (const key of keys.slice(0, -1)) target = target[key] ||= {};
  target[keys.at(-1)] = JSON.parse(option.slice(split + 1));
}
config.mcp_servers = Object.fromEntries((options.mcpNames || []).map(name => [name, { enabled: true }]));
if (options.unsafeConfig) config.features.shell_tool = true;
if (options.stateRuntimeFailure) {
  process.stderr.write("Error: failed to initialize sqlite state runtime under PRIVATE-PATH secret@example.com sk-not-for-client\\n");
  process.exit(1);
}
log({ event: "environment", platformKeysPresent: ["OPENAI_API_KEY", "AZURE_OPENAI_API_KEY", "CODEX_API_KEY"].some((key) => key in process.env) });
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  log(message);
  const result = (value) => send({ id: message.id, result: value });
  if (message.method === "initialize") result({});
  else if (message.method === "config/read") {
    if (options.configUnavailable) send({ id: message.id, error: { code: -32601, message: "config/read unavailable" } });
    else result({ config });
  }
  else if (message.method === "account/read") result({ account: { type: options.accountType || "chatgpt" } });
  else if (message.method === "account/rateLimits/read") result({ ordinaryUsageAllowed: true, rateLimits: { primary: { usedPercent: 12 } } });
  else if (message.method === "thread/start") {
    if (options.configChanged) config.mcp_servers.race_added = { enabled: true };
    if (options.unsupportedOptionalFields && message.params.dynamicTools) send({ id: message.id, error: { code: -32602, message: "unsupported dynamicTools" } });
    else result({ thread: { id: "test-thread" } });
  } else if (message.method === "thread/realtime/start") {
    if (options.unsupportedInitialItems && message.params.initialItems) {
      send({ id: message.id, error: { code: -32602, message: "unsupported initialItems" } });
      return;
    }
    result({});
    send({ method: "thread/realtime/sdp", params: { sdp: "v=0\\r\\ns=mock-answer\\r\\n" } });
    send({ id: "screen-request", method: "item/tool/call", params: { tool: options.toolName || "get_shared_screen", arguments: {} } });
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
      assert.notEqual(threadParams.cwd, path.dirname(process.env.CODEX_BIN ?? ""));
      assert.equal(path.dirname(String(threadParams.cwd)), path.resolve(os.tmpdir()));
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
  "Codexの状態DB初期化失敗では権限の原因を示し生stderrを返さない",
  { concurrency: false, timeout: 15000 },
  async () => {
    await withMock({ stateRuntimeFailure: true }, async (voice) => {
      await assert.rejects(voice.start("v=0\r\n"), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /ローカル状態データベース/);
        assert.match(error.message, /終了コード: 1/);
        assert.doesNotMatch(
          error.message,
          /PRIVATE-PATH|secret@example|sk-not-for-client/,
        );
        return true;
      });
      assert.equal(voice.status().state, "stopped");
      assert.equal(voice.status().auth, null);
    });
  },
);

test(
  "権限制限に必要なフィールドを拒否された場合は設定を落として再試行しない",
  { concurrency: false, timeout: 15000 },
  async () => {
    await withMock(
      { unsupportedOptionalFields: true },
      async (voice, readLog) => {
        const events: VoiceEvent[] = [];
        voice.subscribe((event) => events.push(event));
        await assert.rejects(voice.start("v=0\r\n"), /unsupported dynamicTools/);
        assert.equal(voice.status().state, "stopped");
        assert.equal(events.some(event => event.type === "warning"), false);
        const entries = await readLog();
        assert.equal(entries.filter(entry => entry.method === "thread/start").length, 1);
        assert.equal(entries.some(entry => entry.method === "thread/realtime/start"), false);
        assert.equal((await voice.stop()).state, "stopped");
      },
    );
  },
);

test("未知のCodex版・安全性不明の実効設定ではスレッドを作らない", { concurrency: false }, async () => {
  for (const options of [{ version: "0.999.0" }, { unsafeConfig: true }, { configUnavailable: true }]) {
    await withMock(options, async (voice, readLog) => {
      await assert.rejects(voice.start("v=0\r\n"), /安全|config\/read/);
      assert.equal(voice.status().state, "stopped");
      assert.equal((await readLog()).some(entry => entry.method === "thread/start"), false);
    });
  }
});

test("全機能を既定拒否し特殊文字のMCP名も同じキーで無効にする", { concurrency: false }, async () => {
  const names = ["ordinary", "name.with.dots", 'name"quoted', "name\\backslash", "__proto__"];
  await withMock({ mcpNames: names }, async (voice, readLog) => {
    await voice.start("v=0\r\n");
    const entries = await readLog();
    const command = entries.find(entry => entry.event === "command" && Array.isArray(entry.args) && entry.args[0] === "app-server");
    assert.ok(Array.isArray(command?.args));
    assert.ok(command.args.includes("--strict-config"));
    assert.ok(command.args.includes("features.new_future_capability=false"));
    const params = record(entries.find(entry => entry.method === "thread/start")?.params);
    assert.equal(params.developerInstructions, "");
    const servers = record(record(params.config).mcp_servers);
    assert.deepEqual(Object.keys(servers), names);
    for (const name of names) assert.equal(record(servers[name]).enabled, false);
    const workspace = String(params.cwd);
    await voice.stop();
    await assert.rejects(fs.stat(workspace), { code: "ENOENT" });
  });
});

test("音声開始の必須指示を拒否された場合も再試行しない", { concurrency: false }, async () => {
  await withMock({ unsupportedInitialItems: true }, async (voice, readLog) => {
    await assert.rejects(voice.start("v=0\r\n"), /unsupported initialItems/);
    assert.equal((await readLog()).filter(entry => entry.method === "thread/realtime/start").length, 1);
  });
});

test("接続準備中にMCP設定が追加された場合は音声開始前に停止する", { concurrency: false }, async () => {
  await withMock({ configChanged: true }, async (voice, readLog) => {
    await assert.rejects(voice.start("v=0\r\n"), /設定が変更/);
    assert.equal(voice.status().state, "stopped");
    const entries = await readLog();
    assert.equal(entries.filter(entry => entry.method === "config/read").length, 2);
    assert.equal(entries.some(entry => entry.method === "thread/realtime/start"), false);
  });
});

test("許可していない操作要求を実行せず拒否する", { concurrency: false }, async () => {
  await withMock({ toolName: "exec_command" }, async (voice, readLog) => {
    await voice.start("v=0\r\n");
    const entries = await waitForLog(readLog, entry => entry.id === "screen-request");
    assert.equal(record(entries.find(entry => entry.id === "screen-request")?.result).success, false);
  }, () => { throw new Error("未許可の操作で画像を取得してはいけません"); });
});

test("停止したセッションの画像を再接続した別セッションへ返さない", { concurrency: false, timeout: 15000 }, async () => {
  let release: (frame: SharedFrame) => void = () => {};
  const oldFrame = new Promise<SharedFrame>(resolve => { release = resolve; });
  let frameCalls = 0;
  await withMock({}, async (voice, readLog) => {
    await voice.start("v=0\r\n");
    const deadline = Date.now() + 2000;
    while (frameCalls === 0 && Date.now() < deadline) await delay(10);
    assert.equal(frameCalls, 1);
    await voice.stop();
    await voice.start("v=0\r\n");
    await waitForLog(readLog, entry => entry.id === "screen-request");
    release({ bytes: Buffer.from("PRIVATE_OLD_FRAME"), at: "old" });
    await delay(100);
    const replies = (await readLog()).filter(entry => entry.id === "screen-request");
    assert.equal(replies.length, 1);
    assert.doesNotMatch(JSON.stringify(replies), /UFJJVkFURV9PTERfRlJBTUU=/);
  }, () => ++frameCalls === 1 ? oldFrame : { bytes: Buffer.from([255, 216, 255, 217]), at: "new" });
});
