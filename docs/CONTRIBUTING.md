# 開発ガイド

必要な環境と起動方法は[README](../README.md#必要な環境)、環境変数とデータ保存先は[使い方](使い方.md)を参照してください。外部のnpm依存はなく、`npm install`は不要です。

## 構成

| ファイル | 役割 |
| --- | --- |
| `server.cjs` | ローカルHTTPサーバー、共有画像と状態の保存 |
| `voice.cjs` | Codex App Serverとの認証・音声接続、共有画像の取得ツール |
| `index.html` | 画面共有ページ |
| `voice.html` | 音声会話ページ |
| `scripts/check.cjs` | サーバーとブラウザスクリプトの構文検査 |
| `test/server.test.cjs` | ローカルHTTPと認証・音声接続処理のmockを使ったテスト |

## 検証

```sh
npm run check
npm test
```

GitHub ActionsではWindowsとLinuxで同じ確認を実行します。CIはマイク・スピーカー・実際の画面共有・ChatGPTへの音声接続を実行しません。

実際の利用を確認する場合は、[READMEの手順](../README.md#使い方)に沿って共有と音声接続を開始し、画面の参照と返答音声を確認します。現在までの確認状況は[使い方](使い方.md#確認状況と制限)にまとめています。

## 不具合の報告

[GitHub Issues](https://github.com/apricot-cake/chatgpt-screen-talk/issues)に、利用したOS・ブラウザ・Node.js・Codexのバージョンと、再現手順、期待した結果、実際の結果を記載してください。

共有画像、会話の内容、認証情報を含むログは、そのまま公開Issueへ添付しないでください。実行時データは[データの扱い](使い方.md#データの扱い)を参照してください。
