import {
  ChevronRight,
  Mic,
  Monitor,
  MonitorOff,
  Phone,
  RefreshCw,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useScreenShare } from "./hooks/useScreenShare";
import { useVoiceSession } from "./hooks/useVoiceSession";
import { useVoiceChoices } from "./hooks/useVoiceChoices";
import { VoicePicker } from "./components/VoicePicker";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { Transcript } from "./components/Transcript";

export default function App() {
  const screen = useScreenShare();
  const voice = useVoiceSession();
  const preview = useVoiceSession({ preview: true });
  const voiceSelection = useVoiceChoices();
  const screenIdle = screen.phase === "idle";
  const voiceIdle = voice.phase === "idle";
  const screenWaiting = screen.phase === "selecting";
  const voiceWaiting = voice.phase === "connecting";
  const screenAction = screenIdle
    ? "画面を共有"
    : screen.phase === "selecting"
      ? "画面を選択中"
      : screen.phase === "stopping"
        ? "共有を停止中"
        : "共有を停止";
  const voiceAction = voiceIdle
    ? "会話を開始"
    : voice.phase === "connecting"
      ? "音声に接続中"
      : voice.phase === "stopping"
        ? "会話を終了中"
        : "会話を終了";
  const screenDetails = [
    screen.error ?? screen.message,
    screen.lastFrameAt
      ? `最終更新 ${new Date(screen.lastFrameAt).toLocaleTimeString("ja-JP")}`
      : null,
    voice.lastScreenReadAt
      ? `AIが画面を参照しました ${new Date(voice.lastScreenReadAt).toLocaleTimeString("ja-JP")}`
      : null,
  ]
    .filter(Boolean)
    .join(" / ");

  return (
    <div className="app-shell min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <h1
            title="chatgpt-screen-talk"
            className="min-w-0 truncate text-base font-semibold"
          >
            chatgpt-screen-talk
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            {screen.phase === "sharing" ? (
              <Button
                variant="outline"
                aria-label="共有画面を切り替え"
                title="共有画面を切り替え"
                onClick={() => void screen.switchShare()}
                disabled={screen.isSwitching}
                aria-busy={screen.isSwitching}
              >
                <RefreshCw data-icon="inline-start" />
                <span className="hidden sm:inline">{screen.isSwitching ? "画面を選択中" : "画面を切り替え"}</span>
              </Button>
            ) : null}
            <Button
              variant={screenIdle || screenWaiting ? "default" : "destructive"}
              aria-label={screenAction}
              title={screenAction}
              onClick={() => void (screenIdle ? screen.start() : screen.stop())}
              disabled={screenWaiting || screen.phase === "stopping"}
              aria-busy={screenWaiting || screen.phase === "stopping"}
            >
              {screenIdle || screenWaiting ? (
                <Monitor data-icon="inline-start" />
              ) : (
                <MonitorOff data-icon="inline-start" />
              )}
              <span className="hidden sm:inline">{screenAction}</span>
            </Button>
            <Button
              variant={voiceIdle || voiceWaiting ? "default" : "destructive"}
              aria-label={voiceAction}
              title={voiceAction}
              onClick={() => void (async () => {
                if (!voiceIdle) { await voice.stop(); return; }
                await preview.stop();
                await voice.start(voiceSelection.selectedVoice || undefined);
              })()}
              disabled={voiceWaiting || voice.phase === "stopping" || (voiceIdle && voiceSelection.loading)}
              aria-busy={voiceWaiting || voice.phase === "stopping"}
            >
              {voiceIdle || voiceWaiting ? (
                <Mic data-icon="inline-start" />
              ) : (
                <Phone data-icon="inline-start" className="rotate-[135deg]" />
              )}
              <span className="hidden sm:inline">{voiceAction}</span>
            </Button>
          </div>
        </div>
      </header>
      <main className="app-layout mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <section
          aria-labelledby="screen-title"
          className="screen-panel min-w-0"
        >
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <h2 id="screen-title">画面共有</h2>
                <ConnectionStatus
                  label="画面共有"
                  tone={
                    screen.error
                      ? "error"
                      : screen.phase === "sharing"
                        ? "active"
                        : screen.phase === "idle"
                          ? "idle"
                          : "pending"
                  }
                  message={screenDetails}
                />
              </CardTitle>
            </CardHeader>
            <CardContent className="screen-content flex flex-1 flex-col gap-4">
              <div className="screen-preview relative flex aspect-video items-center justify-center overflow-hidden rounded-lg border bg-muted">
                <video
                  ref={screen.videoRef}
                  autoPlay
                  muted
                  playsInline
                  aria-label="共有画面のプレビュー"
                  className="absolute inset-0 size-full object-contain"
                />
                {screen.phase !== "sharing" ? (
                  <Empty className="relative">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Monitor />
                      </EmptyMedia>
                      <EmptyTitle>画面を共有していません</EmptyTitle>
                      <EmptyDescription>
                        共有中も元のアプリで作業を続けられます。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : null}
              </div>
              {screen.lastFrameAt ? (
                <p className="hidden text-xs text-muted-foreground md:block">
                  最終更新{" "}
                  {new Date(screen.lastFrameAt).toLocaleTimeString("ja-JP")}
                </p>
              ) : null}
              {voice.lastScreenReadAt ? (
                <p className="hidden text-xs text-muted-foreground md:block">
                  AIが画面を参照しました ·{" "}
                  {new Date(voice.lastScreenReadAt).toLocaleTimeString("ja-JP")}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </section>
        <section
          aria-labelledby="conversation-title"
          className="conversation-panel min-w-0"
        >
          <Card className="conversation-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <h2 id="conversation-title">会話</h2>
                <ConnectionStatus
                  label="会話"
                  tone={
                    voice.error || voice.phase === "disconnected"
                      ? "error"
                      : voice.phase === "connected"
                        ? "active"
                        : voice.phase === "idle"
                          ? "idle"
                          : "pending"
                  }
                  message={voice.error ?? voice.message}
                />
              </CardTitle>
              <VoicePicker selection={voiceSelection} preview={preview} disabled={!voiceIdle} />
            </CardHeader>
            <CardContent className="conversation-content flex flex-col gap-4">
              <audio ref={voice.audioRef} autoPlay />
              {voice.needsPlayback || voice.phase === "connected" ? (
                <Button variant="outline" onClick={() => void voice.play()}>
                  <Volume2 data-icon="inline-start" />
                  返答音声を再生
                </Button>
              ) : null}
              <Separator />
              <Transcript captions={voice.captions} />
            </CardContent>
          </Card>
        </section>
        <footer className="data-disclosure md:col-span-2">
          <Collapsible>
            <CollapsibleTrigger
              render={<Button variant="ghost" size="sm" />}
              className="group"
            >
              <ChevronRight
                data-icon="inline-start"
                className="transition-transform group-aria-expanded:rotate-90"
              />
              データの扱い
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="flex flex-col gap-2 px-2.5 pt-3 text-xs leading-6 text-muted-foreground">
                <p>
                  会話中はマイク音声を送信し、画面についての質問には共有画像をOpenAIへ送信して回答します。共有画面の音声は取得しません。
                </p>
                <p>
                  画面共有と会話は個別に停止できます。このタブを閉じると両方とも終了します。CodexのChatGPTログインを使う別セッションのため、このチャットの履歴は引き継ぎません。
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </footer>
      </main>
    </div>
  );
}
