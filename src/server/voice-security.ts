import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

export const SUPPORTED_CODEX_VERSION = "0.164.0";
export const SCREEN_TOOL_NAMESPACE = "shared_screen";
const execute = promisify(execFile);
const WORKSPACE_PREFIX = "chatgpt-screen-talk-voice-";
// 認証の保存先や既存の安全機構は変更しません。操作能力を追加しない機能と音声だけを残します。
const PRESERVED_FEATURES = new Set([
  "realtime_conversation",
  "secret_auth_storage",
  "credential_masking",
  "guardian_approval",
  "write_stdin_approval",
]);
const REQUIRED_FEATURES = [
  "shell_tool", "view_image", "multi_agent", "plugins", "hooks", "apps",
  "goals", "code_mode", "computer_use", "browser_use", "skill_search", "unified_exec",
];
const SETTINGS: Record<string, string | boolean | number | string[]> = {
  approval_policy: "never",
  sandbox_mode: "read-only",
  web_search: "disabled",
  project_doc_max_bytes: 0,
  project_doc_fallback_filenames: [],
  instructions: "",
  developer_instructions: "",
  notify: [],
  "skills.include_instructions": false,
  "tools.experimental_request_user_input.enabled": false,
  "tools.update_plan.enabled": false,
};

export interface CodexExecutable { command: string; prefix: string[] }
export interface VoiceRuntime {
  cwd: string;
  args: string[];
  threadConfig(result: unknown): Record<string, unknown>;
  assertUnchanged(result: unknown, previous: Record<string, unknown>): void;
  dispose(): Promise<void>;
}
function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function unsafe(): Error {
  return new Error(
    "Codexの権限設定を安全に確認できません。対応版のCodexを使用し、個人用の設定を確認してください。安全性を確認できないため音声接続を開始していません。",
  );
}

/** 個人用認証はそのまま使い、操作機能・プロジェクト指示・MCPをこのプロセスで制限します。 */
export async function prepareVoiceRuntime(
  executable: CodexExecutable,
  env: NodeJS.ProcessEnv,
): Promise<VoiceRuntime> {
  const temporaryRoot = path.resolve(os.tmpdir());
  const cwd = await fs.mkdtemp(path.join(temporaryRoot, WORKSPACE_PREFIX));
  const dispose = async () => {
    // 削除できるのは、この呼び出しで作った一時作業フォルダーだけです。
    if (path.dirname(cwd) !== temporaryRoot || !path.basename(cwd).startsWith(WORKSPACE_PREFIX))
      throw unsafe();
    await fs.rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  const run = async (args: string[]) => {
    try {
      const result = await execute(executable.command, [...executable.prefix, ...args], {
        cwd, env, windowsHide: true, timeout: 20_000, maxBuffer: 256 * 1024,
      });
      return result.stdout;
    } catch {
      // CLIの生出力には個人用パスや設定値が含まれる場合があります。
      throw unsafe();
    }
  };
  try {
    const version = (await run(["--version"])).trim();
    if (version !== `codex-cli ${SUPPORTED_CODEX_VERSION}`)
      throw new Error(
        `このアプリが権限を確認できるCodexは${SUPPORTED_CODEX_VERSION}です。npm install -g @openai/codex@${SUPPORTED_CODEX_VERSION} で対応版を用意してください。安全性を確認できないため音声接続を開始していません。`,
      );
    const inventory = await run(["features", "list"]);
    const disabled = new Set<string>();
    const all = new Set<string>();
    for (const line of inventory.trim().split(/\r?\n/)) {
      const match = /^([a-z_0-9.]+)\s+(stable|experimental|under development|deprecated|removed)\s+(true|false)$/.exec(line);
      if (!match) throw unsafe();
      const name = match[1];
      if (!name || all.has(name)) throw unsafe();
      all.add(name);
      if (match[2] !== "removed" && !PRESERVED_FEATURES.has(name)) disabled.add(name);
    }
    if (!REQUIRED_FEATURES.every(name => disabled.has(name))) throw unsafe();
    const overrides = [
      ...[...disabled].filter(name => name !== "code_mode").map(name => [`features.${name}`, false] as const),
      // code-mode-onlyのモデルでも、共有画像だけを直接呼べるようにします。
      ["features.code_mode.enabled", false] as const,
      ["features.code_mode.direct_only_tool_namespaces", [SCREEN_TOOL_NAMESPACE]] as const,
      ...Object.entries(SETTINGS),
    ];
    const args = [
      "app-server", "--enable", "realtime_conversation",
      ...overrides.flatMap(([name, value]) => ["--config", `${name}=${JSON.stringify(value)}`]),
    ];
    const threadConfig = (result: unknown): Record<string, unknown> => {
        const config = object(object(result)?.config);
        const features = object(config?.features);
        if (!config || !features || [...disabled].some(name => name !== "code_mode" && features[name] !== false)) throw unsafe();
        const codeMode = object(features.code_mode);
        if (codeMode?.enabled !== false ||
          Object.keys(codeMode).sort().join(",") !== "direct_only_tool_namespaces,enabled" ||
          !Array.isArray(codeMode.direct_only_tool_namespaces) ||
          codeMode.direct_only_tool_namespaces.length !== 1 ||
          codeMode.direct_only_tool_namespaces[0] !== SCREEN_TOOL_NAMESPACE) throw unsafe();
        if (all.has("realtime_conversation") && features.realtime_conversation !== true) throw unsafe();
        if (
          config.web_search !== "disabled" || config.project_doc_max_bytes !== 0 ||
          config.instructions !== "" || config.developer_instructions !== "" ||
          !Array.isArray(config.notify) || config.notify.length !== 0 ||
          !Array.isArray(config.project_doc_fallback_filenames) || config.project_doc_fallback_filenames.length !== 0 ||
          object(config.skills)?.include_instructions !== false ||
          config.approval_policy !== "never" || config.sandbox_mode !== "read-only"
        ) throw unsafe();
        const servers = config.mcp_servers === undefined ? {} : object(config.mcp_servers);
        if (!servers) throw unsafe();
        // ネストしたJSONのキーとして渡し、名前中のドット・引用符を設定パスに解釈させません。
        const mcpServers = Object.fromEntries(Object.keys(servers).map(id => [id, { enabled: false }]));
        return { mcp_servers: mcpServers };
    };
    return {
      cwd, args, dispose, threadConfig,
      assertUnchanged(result, previous) {
        const before = object(previous.mcp_servers);
        const after = object(threadConfig(result).mcp_servers);
        if (!before || !after ||
          JSON.stringify(Object.keys(before).sort()) !== JSON.stringify(Object.keys(after).sort()))
          throw new Error("接続準備中にCodexの設定が変更されました。音声接続を開始していません。設定の変更を終えてから、もう一度会話を開始してください。");
      },
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
