import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import {
  prepareVoiceRuntime,
  type CodexExecutable,
  type VoiceRuntime,
} from "./voice-security.js";

const RPC_TIMEOUT_MS = 20_000;

class VoiceChoicesError extends Error {}

function failure(stage: string, timedOut = false): VoiceChoicesError {
  return new VoiceChoicesError(
    `声の一覧を取得できませんでした（${stage}${timedOut ? "が時間切れになりました" : "に失敗しました"}）。`,
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function choices(value: unknown): { voices: string[]; defaultVoice: string } {
  const catalog = record(record(value)?.voices);
  const voices = catalog?.v3 === undefined ? catalog?.v1 : catalog.v3;
  const defaultVoice = catalog?.defaultV1;
  const validId = (id: unknown): id is string =>
    typeof id === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(id);
  if (
    !Array.isArray(voices) || voices.length === 0 || voices.length > 128 ||
    !voices.every(validId) || new Set(voices).size !== voices.length ||
    !validId(defaultVoice) || !voices.includes(defaultVoice)
  ) throw failure("声の一覧の検証");
  return { voices, defaultVoice };
}

/** 会話を作らず、音声セッションと同じ制限でCLIの声の一覧だけを読み取ります。 */
export async function readVoiceChoices(
  executable: CodexExecutable,
  env: NodeJS.ProcessEnv,
): Promise<{ voices: string[]; defaultVoice: string }> {
  const childEnv = { ...env };
  for (const key of ["OPENAI_API_KEY", "AZURE_OPENAI_API_KEY", "CODEX_API_KEY"])
    delete childEnv[key];
  let runtime: VoiceRuntime | undefined;
  let child: ChildProcessWithoutNullStreams | undefined;
  let lines: readline.Interface | undefined;
  let closed: Promise<void> | undefined;
  let processClosed = false;
  let processFailed = false;
  let stage = "制限設定の準備";
  let sequence = 0;
  let pending: {
    id: string;
    resolve(value: unknown): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  } | undefined;
  const rejectPending = (error: Error) => {
    if (!pending) return;
    const request = pending;
    pending = undefined;
    clearTimeout(request.timer);
    request.reject(error);
  };

  try {
    runtime = await prepareVoiceRuntime(executable, childEnv);
    stage = "照会プロセスの起動";
    child = spawn(executable.command, [...executable.prefix, ...runtime.args], {
      cwd: runtime.cwd,
      env: childEnv,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    // 個人用パスや設定値が含まれ得る生の診断出力は保存・返却しません。
    child.stderr.resume();
    closed = new Promise<void>((resolve) => {
      child!.once("close", () => {
        processClosed = true;
        processFailed = true;
        rejectPending(failure(stage));
        resolve();
      });
    });
    child.once("error", () => {
      processFailed = true;
      rejectPending(failure(stage));
    });
    child.once("exit", () => {
      processFailed = true;
      rejectPending(failure(stage));
    });
    child.stdin.on("error", () => {
      processFailed = true;
      rejectPending(failure(stage));
    });
    lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      let message: Record<string, unknown> | null;
      try { message = record(JSON.parse(line)); } catch { return; }
      if (!message) return;
      if (typeof message.method === "string") {
        if (typeof message.id === "number" || typeof message.id === "string") {
          child?.stdin.write(JSON.stringify({
            id: message.id,
            error: { code: -32601, message: "このクライアントは操作を提供しません" },
          }) + "\n");
        }
        return;
      }
      if (!pending || message.id !== pending.id) return;
      if (message.error !== undefined || !("result" in message)) {
        rejectPending(failure(stage));
        return;
      }
      const request = pending;
      pending = undefined;
      clearTimeout(request.timer);
      request.resolve(message.result);
    });
    const rpc = (method: string, params: unknown): Promise<unknown> => {
      if (processFailed || !child?.stdin.writable)
        return Promise.reject(failure(stage));
      return new Promise((resolve, reject) => {
        const id = `voice-choices-${++sequence}`;
        const timer = setTimeout(
          () => rejectPending(failure(stage, true)), RPC_TIMEOUT_MS,
        );
        pending = { id, resolve, reject, timer };
        child!.stdin.write(JSON.stringify({ id, method, params }) + "\n");
      });
    };

    stage = "Codexの初期化";
    await rpc("initialize", {
      clientInfo: { name: "chatgpt-screen-talk", version: "0.1.1" },
      capabilities: { experimentalApi: true },
    });
    child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    stage = "制限設定の確認";
    runtime.threadConfig(await rpc("config/read", {
      includeLayers: false, cwd: runtime.cwd,
    }));
    stage = "声の一覧の照会";
    return choices(await rpc("thread/realtime/listVoices", {}));
  } catch (error) {
    throw error instanceof VoiceChoicesError ? error : failure(stage);
  } finally {
    let cleanupFailed = false;
    lines?.close();
    try {
      if (child && closed) {
        child.stdin.end();
        if (!processClosed) child.kill();
        const force = setTimeout(() => {
          if (!processClosed) child?.kill("SIGKILL");
        }, 1000);
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            closed,
            new Promise<never>((_resolve, reject) => {
              timeout = setTimeout(() => reject(failure("照会プロセスの終了", true)), 5000);
            }),
          ]);
        } finally {
          clearTimeout(force);
          clearTimeout(timeout);
        }
      }
    } catch { cleanupFailed = true; }
    try { await runtime?.dispose(); } catch { cleanupFailed = true; }
    if (cleanupFailed) throw failure("照会プロセスの後片付け");
  }
}
