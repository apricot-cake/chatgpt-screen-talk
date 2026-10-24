# chatgpt-screen-talk

アプリやブラウザの画面を共有しながら、マイクで質問して音声で回答を聞くローカルアプリです。

![画面共有と音声会話を並べたアプリ画面](docs/images/screenshot.png)

## 主な機能

- 相談したいウィンドウや画面を選んで共有する。
- マイクで質問し、音声で回答を聞く。
- 画面に関する質問に応じて、共有中の最新画像を参照する。
- 画面共有と音声会話を同じタブで使い、それぞれ開始・停止する。

画面のクリックやキー入力による操作は行わず、共有画面の音声は取得しません。

## 必要な環境

- Node.js 22.12以降
- `codex app-server`を実行できるCodex CLI
- CodexでのChatGPTログイン
- 画面共有・マイク入力・WebRTCに対応したブラウザ。WindowsのChromeまたはEdgeを想定しています。

音声接続には、ChatGPTにログインしたCodex App Serverの実験的なWebRTC機能を使います。利用可否や利用枠は、アカウント・Codexの版・サービス側の提供状況に依存します。OpenAI APIキーへの切り替えは行いません。

## インストール・起動

### Windows

1. [Node.js](https://nodejs.org/en/download)と[Codex CLI](https://learn.chatgpt.com/docs/enterprise/windows-deployment)を用意し、CodexでChatGPTにログインします。
2. [最新版のWindows用ZIP](https://github.com/apricot-cake/chatgpt-screen-talk/releases/latest/download/chatgpt-screen-talk-windows.zip)をダウンロードして展開します。
3. 展開したフォルダーの `start.cmd` をダブルクリックします。

初回は依存のインストールとビルドを行い、準備ができるとブラウザが開きます。2回目以降も同じファイルで起動でき、変更がなければ準備を省略します。必要な環境やログインが不足している場合は、その手順を表示します。

起動中のウィンドウは開いたままにしてください。終了する場合は `Ctrl+C` を押します。

### ターミナルから起動

リポジトリを取得し、そのフォルダーで実行します。

```sh
git clone https://github.com/apricot-cake/chatgpt-screen-talk.git
cd chatgpt-screen-talk
codex login
npm ci --include=dev
npm start
```

`npm start` は型チェックとビルドを行ってからサーバーを起動します。表示される `http://127.0.0.1:ポート番号` をブラウザで開きます。実行ファイルの場所やポート番号を指定する場合は、[設定](docs/使い方.md#設定)を参照してください。

## 使い方

1. 開いたページで画面共有を開始し、相談したいウィンドウや画面を選びます。
2. 同じページで会話を開始し、マイクを許可します。
3. 共有した画面に戻り、「今の画面を見て」などと話しかけます。

このタブは開いたままにしてください。会話の終了と画面共有の停止は別々に操作します。共有を止めても会話は続き、会話を終了しても共有は続きます。サーバーはターミナルの `Ctrl+C` で終了します。

会話中のマイク音声と参照した共有画像は、回答生成のためOpenAIへ送信されます。[データの扱い](docs/使い方.md#データの扱い)を確認してください。

## 確認状況と制限

音声機能は実験的なApp Serverプロトコルに依存します。元の試作では実音声と共有画面を使った回答を確認していますが、ReactによるUI統合後の実音声接続は別途確認が必要です。詳しくは[確認状況と制限](docs/使い方.md#確認状況と制限)を参照してください。

## ドキュメント

- [使い方・設定・データの扱い](docs/使い方.md)
- [開発ガイド](docs/CONTRIBUTING.md)

## 開発・貢献・問い合わせ

構成と検証手順は[開発ガイド](docs/CONTRIBUTING.md)を参照してください。不具合や改善の提案、質問は[GitHub Issues](https://github.com/apricot-cake/chatgpt-screen-talk/issues)で受け付けます。修正はプルリクエストで送れます。

## ライセンス

現時点ではライセンスファイルを配置していません。
