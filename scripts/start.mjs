// @ts-check
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import readline from "node:readline";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const installationHelp =
  "Codex CLIが必要です。公式手順: https://learn.chatgpt.com/docs/enterprise/windows-deployment\nNode.js/npmがある場合: npm install -g @openai/codex";
/** @typedef {{command:string,prefix:string[]}} Command */
/** @typedef {{cwd:string,env:NodeJS.ProcessEnv}} RunOptions */
/** @typedef {'chatgpt'|'apiKey'|'none'} Auth */

/** @param {NodeJS.ProcessEnv} env @returns {Command} */
export function findCodex(env) {
  const candidates = env.CODEX_BIN
    ? [path.resolve(env.CODEX_BIN)]
    : String(env.PATH || env.Path || "")
        .split(path.delimiter)
        .filter(Boolean)
        .flatMap((dir) =>
          (process.platform === "win32"
            ? ["codex.exe", "codex.cmd", "codex"]
            : ["codex"]
          ).map((name) => path.join(dir.replace(/^"|"$/g, ""), name)),
        );
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    if (/\.cmd$/i.test(candidate)) {
      const entry = path.join(
        path.dirname(candidate),
        "node_modules",
        "@openai",
        "codex",
        "bin",
        "codex.js",
      );
      if (!existsSync(entry))
        throw new Error(
          "Codexのnpm配置を確認できません。CODEX_BINにcodex.exeまたは公式codex.jsを指定してください。",
        );
      return { command: process.execPath, prefix: [entry] };
    }
    return /\.(?:c|m)?js$/i.test(candidate)
      ? { command: process.execPath, prefix: [candidate] }
      : { command: candidate, prefix: [] };
  }
  throw new Error(
    env.CODEX_BIN
      ? "CODEX_BINの指定先が見つかりません。設定を確認してください。"
      : installationHelp,
  );
}
/** @param {NodeJS.ProcessEnv} env @returns {Command} */
export function findNpm(env) {
  const entries = [
    env.npm_execpath,
    path.join(
      path.dirname(process.execPath),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
  ];
  for (const dir of String(env.PATH || env.Path || "")
    .split(path.delimiter)
    .filter(Boolean))
    entries.push(
      path.join(
        dir.replace(/^"|"$/g, ""),
        "node_modules",
        "npm",
        "bin",
        "npm-cli.js",
      ),
    );
  for (const entry of entries)
    if (entry && /\.(?:c|m)?js$/i.test(entry) && existsSync(entry))
      return { command: process.execPath, prefix: [entry] };
  throw new Error(
    "npmが見つかりません。npmを含むNode.jsのLTS版をインストールしてください。https://nodejs.org/ja/download",
  );
}
/** @param {string} command @param {string[]} args @param {RunOptions} options @returns {Promise<number>} */
export function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
/** Codexの既存セッションをローカルprotocolで確認。認証情報は表示・保存しない。
 * @param {Command} executable @param {RunOptions} options @returns {Promise<Auth>} */
export function authenticate(executable, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable.command,
      [...executable.prefix, "app-server"],
      { ...options, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    let complete = false;
    child.stdin.on("error", () => {});
    const finish = (/** @type {Auth | Error} */ value) => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill();
      value instanceof Error ? reject(value) : resolve(value);
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "Codexの認証確認が時間切れになりました。codex login status で確認してください。",
          ),
        ),
      20000,
    );
    child.stderr.on("data", () => {});
    child.once("error", () =>
      finish(
        new Error(
          "Codexを起動できませんでした。Codexのインストールを確認してください。",
        ),
      ),
    );
    child.once("exit", () =>
      finish(
        new Error(
          "Codexを初期化できませんでした。通常のユーザー権限で起動し、Codexのデータフォルダーへの書き込み権限を確認してください。",
        ),
      ),
    );
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        const value = JSON.parse(line);
        if (value.id === 1) {
          if (value.error) {
            finish(
              new Error(
                "Codexの初期化に失敗しました。Codexを更新してください。",
              ),
            );
            return;
          }
          child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
          child.stdin.write(
            JSON.stringify({ id: 2, method: "account/read", params: {} }) +
              "\n",
          );
        }
        if (value.id === 2) {
          const type = value.result?.account?.type;
          finish(
            type === "chatgpt"
              ? "chatgpt"
              : type === "apiKey"
                ? "apiKey"
                : "none",
          );
        }
      } catch {}
    });
    child.stdin.write(
      JSON.stringify({
        id: 1,
        method: "initialize",
        params: {
          clientInfo: {
            name: "chatgpt-screen-talk-launcher",
            version: "0.1.0",
          },
        },
      }) + "\n",
    );
  });
}
/** @param {string} root @returns {Promise<string>} */
async function sourceHash(root) {
  const hash = createHash("sha256");
  /** @param {string} relative */
  async function add(relative) {
    const file = path.join(root, relative);
    const stat = await fs.stat(file);
    if (stat.isDirectory()) {
      for (const entry of (await fs.readdir(file)).sort())
        await add(path.join(relative, entry));
    } else {
      hash.update(relative.replaceAll("\\", "/"));
      hash.update(await fs.readFile(file));
    }
  }
  for (const name of (await fs.readdir(root))
    .filter(
      (name) =>
        name.endsWith(".html") ||
        /^tsconfig.*\.json$/.test(name) ||
        /^vite\.config\./.test(name) ||
        ["package.json", "package-lock.json", "components.json"].includes(name),
    )
    .sort())
    await add(name);
  await add("src");
  return hash.digest("hex");
}
/** @param {string} url @returns {Promise<void>} */
export function openBrowser(url) {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(url))
    return Promise.reject(new Error("起動先URLが無効です"));
  // URLは検証済みの引数として渡し、シェル用コマンドへ連結しない。
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Start-Process -FilePath $env:CHATGPT_SCREEN_TALK_URL",
      ],
      {
        env: { ...process.env, CHATGPT_SCREEN_TALK_URL: url },
        stdio: "ignore",
        windowsHide: true,
      },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("ブラウザを開けませんでした")),
    );
  });
}
/** @param {{rootDir:string,env:NodeJS.ProcessEnv,openBrowser?:(url:string)=>Promise<void>,fetchImpl?:typeof fetch,spawnServer?:typeof spawn}} options */
export async function serve({
  rootDir,
  env,
  openBrowser: open = openBrowser,
  fetchImpl = fetch,
  spawnServer = spawn,
}) {
  const child = spawnServer(
    process.execPath,
    [path.join(rootDir, "dist", "server", "server.js")],
    {
      cwd: rootDir,
      env,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
    },
  );
  const stopped = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  let ending = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let shutdownTimer;
  const end = () => {
    if (ending) return;
    ending = true;
    if (child.connected) child.send({ type: "launcher:shutdown" });
    else child.kill("SIGINT");
    shutdownTimer = setTimeout(() => child.kill(), 6000);
    shutdownTimer.unref();
  };
  process.once("SIGINT", end);
  process.once("SIGTERM", end);
  if (!child.stdout) {
    child.kill();
    throw new Error("サーバーの起動出力を取得できませんでした。");
  }
  const lines = readline.createInterface({ input: child.stdout });
  child.stderr?.pipe(process.stderr);
  try {
    const url = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("サーバーの起動が時間切れになりました。")),
        30000,
      );
      lines.on("line", (line) => {
        console.log(line);
        if (/^http:\/\/127\.0\.0\.1:\d+$/.test(line)) {
          clearTimeout(timeout);
          resolve(line);
        }
      });
      stopped.then(() => {
        clearTimeout(timeout);
        reject(new Error("サーバーが起動前に終了しました。"));
      }, reject);
    });
    if (typeof url !== "string")
      throw new Error("サーバーURLを取得できませんでした。");
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(10000),
    });
    if (response.status !== 200 || child.exitCode !== null)
      throw new Error("起動したサーバーのHTTP応答を確認できませんでした。");
    console.log(
      "準備ができました。終了するには、このウィンドウで Ctrl+C を押してください。",
    );
    try {
      await open(url);
    } catch {
      console.log(
        "ブラウザを自動で開けませんでした。次のURLを開いてください: " + url,
      );
    }
    const result = await stopped;
    if (!ending && result.code !== 0)
      throw new Error("サーバーが終了しました。");
  } catch (error) {
    if (!ending) throw error;
  } finally {
    clearTimeout(shutdownTimer);
    process.removeListener("SIGINT", end);
    process.removeListener("SIGTERM", end);
    lines.close();
    if (child.exitCode === null) child.kill();
  }
}
/** @param {{rootDir?:string,env?:NodeJS.ProcessEnv,run?:typeof run,authenticate?:typeof authenticate,serve?:(options:{rootDir:string,env:NodeJS.ProcessEnv})=>Promise<void>,nodeVersion?:string}} [options] */
export async function launch(options = {}) {
  const [major = 0, minor = 0] = (options.nodeVersion || process.versions.node)
    .split(".")
    .map(Number);
  if (major < 22 || (major === 22 && minor < 12))
    throw new Error(
      "Node.js 22.12以降が必要です。https://nodejs.org/ja/download",
    );
  const rootDir = options.rootDir || projectRoot;
  const env = { ...(options.env || process.env) };
  for (const key of ["OPENAI_API_KEY", "AZURE_OPENAI_API_KEY", "CODEX_API_KEY"])
    delete env[key];
  const npm = findNpm(env),
    codex = findCodex(env);
  const auth = await (options.authenticate || authenticate)(codex, {
    cwd: rootDir,
    env,
  });
  if (auth === "apiKey")
    throw new Error(
      "CodexはAPIキーでログインしています。このアプリはChatGPTログインが必要です。現在の認証は変更していません。必要な場合はご自身で codex login を実行してください。",
    );
  if (auth !== "chatgpt")
    throw new Error(
      "ChatGPTへのログインが必要です。codex login を実行してから、もう一度起動してください。",
    );
  const dataDir = path.resolve(rootDir, env.DATA_DIR || ".data");
  await fs.mkdir(dataDir, { recursive: true });
  const stampFile = path.join(dataDir, "launcher-state.json");
  /** @type {{lockHash?:string,buildHash?:string}} */
  let stamp = {};
  try {
    /** @type {unknown} */
    const saved = JSON.parse(await fs.readFile(stampFile, "utf8"));
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      if ("lockHash" in saved && typeof saved.lockHash === "string")
        stamp.lockHash = saved.lockHash;
      if ("buildHash" in saved && typeof saved.buildHash === "string")
        stamp.buildHash = saved.buildHash;
    }
  } catch {}
  const lockHash = createHash("sha256")
    .update(await fs.readFile(path.join(rootDir, "package-lock.json")))
    .digest("hex");
  const buildHash = await sourceHash(rootDir);
  const invoke = options.run || run;
  const dependenciesReady = [
    "typescript/bin/tsc",
    "vite/bin/vite.js",
    "fastify/fastify.js",
    "react/package.json",
  ].every((name) => existsSync(path.join(rootDir, "node_modules", name)));
  const install = stamp.lockHash !== lockHash || !dependenciesReady;
  if (install) {
    console.log("初回の準備: 必要なパッケージをインストールしています…");
    if (
      (await invoke(npm.command, [...npm.prefix, "ci", "--include=dev"], {
        cwd: rootDir,
        env,
      })) !== 0
    )
      throw new Error(
        "依存パッケージのインストールに失敗しました。接続状況を確認して再起動してください。",
      );
  }
  const built =
    existsSync(path.join(rootDir, "dist/server/server.js")) &&
    existsSync(path.join(rootDir, "dist/client/index.html")) &&
    existsSync(path.join(rootDir, "dist/client/assets"));
  if (install || stamp.buildHash !== buildHash || !built) {
    console.log("アプリを準備しています…");
    if (
      (await invoke(npm.command, [...npm.prefix, "run", "build"], {
        cwd: rootDir,
        env,
      })) !== 0
    )
      throw new Error(
        "ビルドに失敗しました。上のエラーを確認してください。古いアプリは起動していません。",
      );
    await fs.writeFile(
      stampFile,
      JSON.stringify({ lockHash, buildHash }, null, 2),
    );
  }
  await (options.serve || serve)({ rootDir, env });
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  launch().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "起動に失敗しました。",
    );
    process.exitCode = 1;
  });
}
