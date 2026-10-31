import { useEffect, useRef, useState } from "react";
import { Copy, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { Caption } from "../hooks/useVoiceSession";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timeout.current), []);
  const copy = async () => {
    // クリック時点の文字列をコピーし、会話の追記に影響されないようにする。
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
    clearTimeout(timeout.current);
    timeout.current = setTimeout(() => setStatus("idle"), 3000);
  };
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="ghost" aria-label={label} disabled={!text} onClick={() => void copy()}>
        <Copy data-icon="inline-start" />
        {label}
      </Button>
      <span role="status" className="text-xs text-muted-foreground">
        {status === "copied" ? "コピーしました" : status === "error" ? "コピーできませんでした。文字を選択してコピーしてください。" : ""}
      </span>
    </div>
  );
}

export function Transcript({ captions }: { captions: Caption[] }) {
  const viewport = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const following = useRef(true);
  const selecting = useRef(false);
  useEffect(() => {
    const node = viewport.current;
    const body = content.current;
    if (!node || !body) return;
    const follow = () => {
      const selection = window.getSelection();
      const selected = selection && !selection.isCollapsed &&
        (body.contains(selection.anchorNode) || body.contains(selection.focusNode));
      if (following.current && !selecting.current && !selected) node.scrollTop = node.scrollHeight;
    };
    const release = () => { selecting.current = false; };
    const observer = new ResizeObserver(follow);
    observer.observe(body);
    observer.observe(node);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      observer.disconnect();
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);
  const fullText = captions.map(caption => `${caption.role === "user" ? "あなた" : "AI"}\n${caption.text}`).join("\n\n");
  return (
    <>
      <div className="flex justify-end">
        <CopyButton text={fullText} label="会話をコピー" />
      </div>
      <div
        ref={viewport}
        role="log"
        aria-label="会話の文字起こし"
        aria-live="polite"
        tabIndex={0}
        onPointerDown={() => { selecting.current = true; }}
        onScroll={event => {
          const node = event.currentTarget;
          following.current = node.scrollHeight - node.clientHeight - node.scrollTop < 32;
        }}
        className="transcript h-[50svh] min-h-64 overflow-y-auto overscroll-contain rounded-md p-1"
      >
        <div ref={content} className="flex min-h-full flex-col gap-6">
          {captions.length === 0 ? (
            <Empty className="flex-1">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Mic /></EmptyMedia>
                <EmptyTitle>声で質問してみましょう</EmptyTitle>
                <EmptyDescription>話した内容がここに表示されます。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : captions.map(caption => (
            <article key={caption.id} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">{caption.role === "user" ? "あなた" : "AI"}</p>
                <CopyButton text={caption.text} label="発言をコピー" />
              </div>
              <p className="select-text whitespace-pre-wrap break-words text-sm leading-7">{caption.text}</p>
            </article>
          ))}
        </div>
      </div>
    </>
  );
}
