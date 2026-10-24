# 開発ガイド

開発時の起動方法、コードの構成、テストの実行方法をまとめています。必要な環境は[README](../README.md#必要な環境)、環境変数やデータの保存先は[使い方](使い方.md)を参照してください。

## ターミナルからの起動

リポジトリを取得し、そのフォルダーで次のコマンドを実行します。CodexにはChatGPTアカウントでログインしてください。

```sh
git clone https://github.com/apricot-cake/chatgpt-screen-talk.git
cd chatgpt-screen-talk
codex login
npm ci --include=dev
npm start
```

`npm start` は毎回、型チェックとビルドを行ってからサーバーを起動します。表示された `http://127.0.0.1:ポート番号` をブラウザで開いてください。終了するときは、ターミナルで `Ctrl+C` を押します。

Codexの実行ファイルやポート番号を指定する方法は、[設定](使い方.md#設定)を参照してください。

## 構成

画面はReactとTypeScriptで作り、UIにはshadcn/uiとTailwind CSSを使っています。画面共有、マイク入力、WebRTCによる音声の送受信には、ブラウザ標準APIを使います。

ローカルサーバーはFastifyで動作します。共有画像を保存し、Codex App Serverへの音声接続を管理します。通信データの検証と型定義にはTypeBoxを使っています。

| ファイル                                                            | 役割                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------- |
| `src/client/main.tsx`、`index.html`                                 | Reactを起動する入口                                           |
| `src/client/App.tsx`                                                | 画面共有、音声会話、文字起こしを表示する画面                  |
| `src/client/hooks/`                                                 | 画面共有、画像更新、マイク、音声接続の状態管理                |
| `src/client/components/`、`src/client/index.css`、`src/client/lib/` | UIの部品、スタイル、共通処理                                  |
| `src/server/server.ts`、`src/server/app.ts`                         | サーバーの起動、HTTP API、共有画像と状態の保存、SSEによる通知 |
| `src/server/voice.ts`                                               | Codex App Serverとの認証・音声接続、共有画像の取得ツール      |
| `src/shared/contracts.ts`                                           | TypeBoxによる通信データの検証と型定義                         |
| `start.cmd`、`scripts/start.mjs`                                    | ダブルクリックでの起動、環境確認、初回準備、ブラウザ表示      |
| `vite.config.ts`、`tsconfig*.json`                                  | ビルドと型チェックの設定                                      |
| `test/`                                                             | HTTP API、音声接続、終了処理、ランチャーのテスト              |

画面共有と音声会話は同じページで使います。それぞれ個別に開始・停止できます。以前の音声ページ `/voice` と `/voice.html` へのアクセスは、現在のページ `/` にリダイレクトします。

起動用の `scripts/start.mjs` は、依存パッケージを導入する前にも動くよう、Node.jsで直接実行できるJavaScriptで記述しています。`package-lock.json` とソースの変更を確認し、必要な場合だけ依存パッケージの導入とビルドを行います。

## 検証

変更内容に応じて、次のコマンドで確認します。

| コマンド        | 確認する内容                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `npm run check` | ブラウザ、サーバー、テスト、ビルド設定のTypeScriptと、ランチャーのJavaScriptの型チェック            |
| `npm run build` | 型チェックとビルド。ブラウザ用ファイルを `dist/client/`、サーバー用ファイルを `dist/server/` に生成 |
| `npm test`      | ビルド後に、アプリとランチャーのテストを実行                                                        |

テストでは、送信元と入力内容の検証、共有画像の保存と停止、音声接続の開始・終了、ランチャーの初回準備や再起動を確認します。音声接続のテストでは、外部サービスとの通信を模擬する処理（mock）を使っています。

一度ビルドした後、アプリ本体を変更していない場合は、ビルドを省いてテストだけ実行できます。

```sh
npx tsc -p tsconfig.test.json
node --test dist-tests/test/*.test.js test/launcher.test.mjs
```

GitHub Actionsでは、WindowsとLinuxで `npm ci` と `npm test` を実行します。マイク、スピーカー、実際の画面共有、ChatGPTへの音声接続はCIでは確認しません。

実際の動作は、[READMEの手順](../README.md#使い方)に沿って画面共有と会話を開始して確認します。共有した画面について質問し、画面の内容を参照した返答が聞こえることを確かめてください。これまでの確認状況は[使い方](使い方.md#確認状況と制限)にまとめています。

## 不具合の報告

[GitHub Issues](https://github.com/apricot-cake/chatgpt-screen-talk/issues)に、再現手順、期待した結果、実際の結果を記載してください。OS、ブラウザ、Node.js、Codexのバージョンも添えてください。

共有画像やログを添付する前に、認証情報や公開したくない会話・画面の内容を取り除いてください。保存されるデータについては、[データの扱い](使い方.md#データの扱い)を参照してください。
