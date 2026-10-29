# 開発ガイド

開発時の起動方法、コードの構成、テストの実行方法をまとめています。必要な環境は[README](../README.md#必要な環境)、環境変数やデータの保存先は[利用ガイド](利用ガイド.md)を参照してください。

## ターミナルからの起動

リポジトリを取得し、そのフォルダーで次のコマンドを実行します。CodexにはChatGPTアカウントでログインしてください。

```sh
git clone https://github.com/apricot-cake/chatgpt-screen-talk.git
cd chatgpt-screen-talk
codex login
npm ci --include=dev
npm start
```

`npm start` は毎回、型チェックとビルドを行ってからサーバーを起動します。表示された起動URLを、末尾の `#token=...` を含めてブラウザで開いてください。終了するときは、ターミナルで `Ctrl+C` を押します。

画面共有と音声のAPIは、起動ごとに生成する認証情報を要求します。ブラウザは起動URLから認証情報を受け取り、同じタブでの再読み込みに使うために `sessionStorage` へ保存してから、URLの末尾を取り除きます。認証情報はAPIの `Authorization` ヘッダーで送信します。サーバーを起動し直した場合は、新しい起動URLから開いてください。

Codexの実行ファイルやポート番号を指定する方法は、[設定](利用ガイド.md#設定)を参照してください。

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
| `src/server/voice-security.ts`                                      | Codexの対応バージョン、機能・ツール・指示の継承範囲の制限     |
| `src/shared/contracts.ts`                                           | TypeBoxによる通信データの検証と型定義                         |
| `start.cmd`、`scripts/start.mjs`                                    | ダブルクリックでの起動、環境確認、初回準備、ブラウザ表示      |
| `vite.config.ts`、`tsconfig*.json`                                  | ビルドと型チェックの設定                                      |
| `test/`                                                             | HTTP API、音声接続、終了処理、ランチャーのテスト              |

画面共有と音声会話は同じページで使います。それぞれ個別に開始・停止できます。以前の音声ページ `/voice` と `/voice.html` へのアクセスは、現在のページ `/` にリダイレクトします。

起動用の `scripts/start.mjs` は、依存パッケージを導入する前にも動くよう、Node.jsで直接実行できるJavaScriptで記述しています。`package-lock.json` とソースの変更を確認し、必要な場合だけ依存パッケージの導入とビルドを行います。

### 音声セッションの権限

このアプリが提供するツールは、共有画像を取得する `shared_screen.get_shared_screen` です。通常の会話では、これに加えてCodex標準のウェブ検索を有効にします。最新の情報が必要な質問はCodexへ委譲して検索し、検索結果の文章も指示ではなく資料として扱います。コマンド実行などの操作機能、MCP、通知コマンドは無効にします。

Code Mode専用のモデルでもツールを使えるよう、`features.code_mode.enabled=false` を保ち、`direct_only_tool_namespaces` に `shared_screen` と `web` を指定します。ウェブ検索は `web_search="live"` と `features.standalone_web_search=true` で有効にし、独自の検索ツールは追加しません。接続前にこの設定の完全一致を確認し、共有画像の取得要求を受け取る際も名前空間とツール名を照合します。

作業フォルダーの指示や個人用のskillsなどは引き継ぎません。ただし、Codexの共通指示（`CODEX_HOME`の`AGENTS.md`）は音声会話にも適用されます。共通指示によってツールや権限が追加されることはありません。

接続前に対応バージョンと実効設定を確認します。制限を確認できない場合や、共有画像ツールが使えない場合は接続を開始しません。Codexの設定ファイルは書き換えません。

声の選択肢は、ウェブ検索を無効にした別の短時間の照会プロセスで `thread/realtime/listVoices` から取得します。この照会では会話を作りません。V3の一覧に含まれる声だけを開始時の `voice` に渡します。会話中の声の変更は、終了後の再接続で行います。

試聴は同じWebRTC接続を使い、入力機器の代わりにWeb Audioの無音トラックを送ります。ウェブ検索を無効にし、画面ツールを登録せず、`appendSpeech` で固定の短文だけを一度再生します。再生後の無音、手動停止、声の変更、ページを離れる操作で接続を終了し、長くても12秒で停止します。

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

実際の動作は、[READMEの手順](../README.md#使い方)に沿って画面共有と会話を開始して確認します。共有した画面について質問し、画面の内容を参照した返答が聞こえることを確かめてください。これまでの確認状況は[利用ガイド](利用ガイド.md#確認状況と制限)にまとめています。

## 不具合の報告

[GitHub Issues](https://github.com/apricot-cake/chatgpt-screen-talk/issues)に、再現手順、期待した結果、実際の結果を記載してください。OS、ブラウザ、Node.js、Codexのバージョンも添えてください。

共有画像やログを添付する前に、認証情報や公開したくない会話・画面の内容を取り除いてください。保存されるデータについては、[データの扱い](利用ガイド.md#データの扱い)を参照してください。
