@echo off
setlocal
chcp 65001 >nul
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js が見つかりません。Node.js 22.12以降のLTS版をインストールしてください。
  echo https://nodejs.org/ja/download
  echo インストール後、このファイルをもう一度開いてください。
  pause
  exit /b 1
)
node.exe "%~dp0scripts\start.mjs"
if errorlevel 1 (
  echo.
  echo 起動できませんでした。上の説明を確認してください。
  pause
  exit /b 1
)
