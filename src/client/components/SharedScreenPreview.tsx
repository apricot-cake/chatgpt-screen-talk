import { useEffect, useRef } from "react";
import { MonitorOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SharedScreen } from "../hooks/useScreenShare";

export function SharedScreenPreview({ screen, onStop }: { screen: SharedScreen; onStop: (id: string) => Promise<void> }) {
  const video = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const node = video.current;
    if (!node) return;
    node.srcObject = screen.stream;
    void node.play().catch(() => {});
    return () => { node.srcObject = null; };
  }, [screen.stream]);
  return (
    <figure className="flex shrink-0 flex-col gap-2">
      <figcaption className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{screen.label}</span>
        <Button variant="outline" size="sm" aria-label={`${screen.label}の共有を停止`} onClick={() => void onStop(screen.id)}>
          <MonitorOff data-icon="inline-start" />
          停止
        </Button>
      </figcaption>
      <video ref={video} autoPlay muted playsInline aria-label={`${screen.label}のプレビュー`} className="aspect-video w-full rounded-lg border bg-muted object-contain" />
      <p className="text-xs text-muted-foreground">
        {screen.lastFrameAt ? `最終更新 ${new Date(screen.lastFrameAt).toLocaleTimeString("ja-JP")}` : "最初の画像を準備しています…"}
      </p>
    </figure>
  );
}
