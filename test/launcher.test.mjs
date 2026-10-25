// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { launch, serve, openBrowser } from "../scripts/start.mjs";

/** @param {(fixture: Awaited<ReturnType<typeof createFixture>>)=>Promise<void>} run */
async function fixture(run) {
  const value = await createFixture();
  try {
    await run(value);
  } finally {
    await fs.rm(value.rootDir, { recursive: true, force: true });
  }
}
async function createFixture() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "screen-talk 起動 "));
  await fs.mkdir(path.join(rootDir, "src"));
  await fs.writeFile(path.join(rootDir, "src", "app.ts"), "export {};");
  for (const [name, value] of Object.entries({
    "package.json": "{}",
    "package-lock.json": "{}",
    "index.html": "<main></main>",
    "npm.js": "",
    "codex.js": "",
  }))
    await fs.writeFile(path.join(rootDir, name), value);
  /** @type {string[]} */
  const calls = [];
  let buildFails = false;
  /** @type {NonNullable<Parameters<typeof launch>[0]>} */
  const options = {
    rootDir,
    nodeVersion: "22.12.0",
    env: {
      npm_execpath: path.join(rootDir, "npm.js"),
      CODEX_BIN: path.join(rootDir, "codex.js"),
    },
    authenticate: async () => "chatgpt",
    run: async (_command, args, { cwd }) => {
      assert.equal(cwd, rootDir);
      const install = args.includes("ci");
      calls.push(install ? "ci" : "build");
      if (install) {
        assert.ok(args.includes("--include=dev"));
        for (const file of [
          "typescript/bin/tsc",
          "vite/bin/vite.js",
          "fastify/fastify.js",
          "react/package.json",
        ]) {
          await fs.mkdir(
            path.dirname(path.join(rootDir, "node_modules", file)),
            { recursive: true },
          );
          await fs.writeFile(path.join(rootDir, "node_modules", file), "");
        }
      } else {
        if (buildFails) return 1;
        await fs.mkdir(path.join(rootDir, "dist/client/assets"), {
          recursive: true,
        });
        await fs.mkdir(path.join(rootDir, "dist/server"), { recursive: true });
        await fs.writeFile(path.join(rootDir, "dist/client/index.html"), "");
        await fs.writeFile(path.join(rootDir, "dist/server/server.js"), "");
      }
      return 0;
    },
    serve: async () => {
      calls.push("serve");
    },
  };
  return {
    rootDir,
    options,
    calls,
    failBuild: () => {
      buildFails = true;
    },
  };
}

test("認証付き起動URLを開き、HTTP確認には認証情報を含めない", async (t) => {
  t.mock.method(console, "log", () => {});
  await fixture(async ({ rootDir, options }) => {
    const startupUrl = "http://127.0.0.1:51234/#token=" + "a".repeat(43);
    await fs.mkdir(path.join(rootDir, "dist/server"), { recursive: true });
    await fs.writeFile(
      path.join(rootDir, "dist/server/server.js"),
      `console.log(${JSON.stringify(startupUrl)}); setTimeout(() => {}, 1000);`,
    );
    let opened = false;
    let checked = false;
    await serve({
      rootDir,
      env: options.env ?? {},
      fetchImpl: async (url) => {
        assert.equal(url, new URL(startupUrl).origin);
        checked = true;
        return new Response("ready", { status: 200 });
      },
      openBrowser: async (url) => {
        assert.equal(checked, true);
        assert.equal(url, startupUrl);
        opened = true;
      },
    });
    assert.equal(opened, true);
  });
});

test("外部URLや認証情報のない起動URLをブラウザへ渡さない", async () => {
  for (const url of [
    "https://example.invalid/#token=" + "a".repeat(43),
    "http://127.0.0.1:51234/",
    "http://127.0.0.1:51234/#token=invalid",
    "http://127.0.0.1:51234/#token=" + "a".repeat(43) + ";calc",
  ])
    await assert.rejects(openBrowser(url), /起動先URLが無効/);
});

test("未認証とAPI認証では準備・起動せず既存認証を変更しない", async () => {
  await fixture(async ({ options, calls }) => {
    await assert.rejects(
      launch({ ...options, authenticate: async () => "none" }),
      /codex login/,
    );
    await assert.rejects(
      launch({ ...options, authenticate: async () => "apiKey" }),
      /APIキー/,
    );
    assert.deepEqual(calls, []);
  });
});
test("初回ci/build、2回目省略、ソース変更build、lock変更ci/build", async () => {
  await fixture(async ({ rootDir, options, calls }) => {
    await launch(options);
    assert.deepEqual(calls, ["ci", "build", "serve"]);
    calls.length = 0;
    await launch(options);
    assert.deepEqual(calls, ["serve"]);
    calls.length = 0;
    await fs.appendFile(path.join(rootDir, "src/app.ts"), "\n// changed");
    await launch(options);
    assert.deepEqual(calls, ["build", "serve"]);
    calls.length = 0;
    await fs.writeFile(
      path.join(rootDir, "package-lock.json"),
      '{"lockfileVersion":3}',
    );
    await launch(options);
    assert.deepEqual(calls, ["ci", "build", "serve"]);
  });
});
test("古いdistが残ってもビルド失敗時は起動せずstampを更新しない", async () => {
  await fixture(async ({ rootDir, options, calls, failBuild }) => {
    await launch(options);
    const before = await fs.readFile(
      path.join(rootDir, ".data/launcher-state.json"),
      "utf8",
    );
    calls.length = 0;
    await fs.appendFile(path.join(rootDir, "src/app.ts"), "\n// change");
    failBuild();
    await assert.rejects(launch(options), /古いアプリは起動していません/);
    assert.deepEqual(calls, ["build"]);
    assert.equal(
      await fs.readFile(
        path.join(rootDir, ".data/launcher-state.json"),
        "utf8",
      ),
      before,
    );
  });
});
test("壊れたstampと依存欠損から初回準備へ復帰する", async () => {
  await fixture(async ({ rootDir, options, calls }) => {
    await launch(options);
    calls.length = 0;
    await fs.writeFile(path.join(rootDir, ".data/launcher-state.json"), "null");
    await launch(options);
    assert.deepEqual(calls, ["ci", "build", "serve"]);
    calls.length = 0;
    await fs.rm(path.join(rootDir, "node_modules/typescript/bin/tsc"));
    await launch(options);
    assert.deepEqual(calls, ["ci", "build", "serve"]);
  });
});
