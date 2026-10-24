# 開発ガイド

必要な環境と起動方法は[README](../README.md#必要な環境)、環境変数とデータ保存先は[使い方](使い方.md)を参照してください。ターミナルからの初回準備は `npm ci --include=dev` で行います。

## 構成

| ファイル | 役割 |
| --- | --- |
| `src/server/server.ts` | ローカルサーバーの起動 |
| `src/server/app.ts` | FastifyのAPI、共有画像と状態の保存、SSE |
| `src/server/voice.ts` | Codex App Serverとの認証・音声接続、共有画像の取得ツール |
| `start.cmd`、`scripts/start.mjs` | Windowsの起動入口、環境確認、初回準備とブラウザ表示 |
| `src/client/main.tsx`、`index.html` | Reactの起動と単一ページの入口 |
| `src/client/App.tsx` | 画面共有・音声会話・文字起こしの画面 |
| `src/client/hooks/useScreenShare.ts` | 画面共有の開始・停止と画像更新 |
| `src/client/hooks/useVoiceSession.ts` | マイク・WebRTC・音声接続の状態管理 |
| `src/client/components/ui/` | shadcn/uiのコンポーネント |
| `src/client/index.css`、`src/client/lib/utils.ts` | Tailwind CSSの設定とUI共通処理 |
| `src/shared/contracts.ts` | TypeBoxのJSON Schemaと通信データの型定義 |
| `vite.config.ts`、`tsconfig.*.json` | ブラウザのビルドと各環境の型チェック設定 |
| `test/*.test.ts`、`test/launcher.test.mjs` | HTTP・音声接続のmock・終了処理・起動時の準備処理の検証 |

ブラウザ側はVite、React、TypeScriptを使い、UIはshadcn/uiとTailwind CSSで組み立てます。画面共有・マイク・WebRTCにはブラウザ標準APIを使います。ローカルAPIはFastify、通信データの検証と型定義はTypeBoxを使います。

画面共有と音声会話は同じページにあり、開始・停止を独立して扱います。以前の `/voice` と `/voice.html` は `/` にリダイレクトします。

`scripts/start.mjs` は依存の導入前にも動かす起動処理のため、Node.jsで直接実行します。アプリ本体はTypeScriptです。起動処理はlockfileとソースの変更を確認し、必要な場合だけ依存導入とビルドを行います。

## 検証

```sh
npm run check
npm run build
npm test
```

`check` はブラウザ・サーバー・テスト・ビルド設定のTypeScriptと、起動処理のJavaScriptを型チェックします。`build` は型チェック後、ブラウザ用ファイルを `dist/client/`、サーバーを `dist/server/` に生成します。`npm start` はビルド後にサーバーを起動します。

`test` は `pretest` でビルドを行ってから、HTTP・音声接続処理のmock・接続終了のテストを実行します。ビルド済みのファイルを直接確認する場合は、テストのコンパイル後に `node --test dist-tests/test/*.test.js test/launcher.test.mjs` を実行できます。

GitHub ActionsではWindowsとLinuxで `npm ci` と `npm test` を実行します。CIはマイク・スピーカー・実際の画面共有・ChatGPTへの音声接続を実行しません。

実際の利用を確認する場合は、[READMEの手順](../README.md#使い方)に沿って共有と音声接続を開始し、画面の参照と返答音声を確認します。現在までの確認状況は[使い方](使い方.md#確認状況と制限)にまとめています。

## 不具合の報告

[GitHub Issues](https://github.com/apricot-cake/chatgpt-screen-talk/issues)に、利用したOS・ブラウザ・Node.js・Codexのバージョンと、再現手順、期待した結果、実際の結果を記載してください。

共有画像、会話の内容、認証情報を含むログは、そのまま公開Issueへ添付しないでください。実行時データは[データの扱い](使い方.md#データの扱い)を参照してください。
