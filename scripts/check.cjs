const fs = require("node:fs");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
for (const file of ["server.cjs", "voice.cjs"])
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
for (const file of ["index.html", "voice.html"]) {
  const html = fs.readFileSync(file, "utf8");
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
    new vm.Script(match[1], { filename: file });
}
console.log("サーバーとブラウザスクリプトの構文を確認しました。");
