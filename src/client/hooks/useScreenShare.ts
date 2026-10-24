import { useCallback, useEffect, useRef, useState } from "react";

type Phase = "idle" | "selecting" | "sharing" | "stopping";
interface CaptureController {
  setFocusBehavior(value: "no-focus-change"): void;
}

export function useScreenShare() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const current = useRef({
    phase: "idle" as Phase,
    generation: 0,
    stream: null as MediaStream | null,
    timer: undefined as ReturnType<typeof setInterval> | undefined,
    upload: null as AbortController | null,
  });
  const mounted = useRef(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("画面を共有していません。");
  const [error, setError] = useState<string | null>(null);
  const [frames, setFrames] = useState(0);
  const [lastFrameAt, setLastFrameAt] = useState<string | null>(null);
  const release = useCallback(() => {
    const c = current.current;
    ++c.generation;
    clearInterval(c.timer);
    c.timer = undefined;
    c.upload?.abort();
    c.upload = null;
    c.stream?.getTracks().forEach((track) => track.stop());
    c.stream = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);
  const stop = useCallback(async () => {
    const c = current.current;
    if (c.phase === "stopping" || c.phase === "idle") return;
    release();
    const gen = c.generation;
    c.phase = "stopping";
    if (mounted.current) {
      setPhase("stopping");
      setError(null);
      setMessage("画面共有を停止しました。");
    }
    await fetch("/stop", { method: "POST" }).catch(() => {});
    if (c.generation === gen) {
      c.phase = "idle";
      if (mounted.current) setPhase("idle");
    }
  }, [release]);
  const start = useCallback(async () => {
    const c = current.current;
    if (c.phase !== "idle") return;
    setError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError(
        "このブラウザは画面共有に対応していません。ChromeまたはEdgeで開いてください。",
      );
      setMessage(
        "このブラウザは画面共有に対応していません。ChromeまたはEdgeで開いてください。",
      );
      return;
    }
    c.phase = "selecting";
    const gen = ++c.generation;
    const valid = () => mounted.current && gen === c.generation;
    setPhase("selecting");
    setMessage("共有する画面を選んでください。");
    try {
      const Controller = (
        globalThis as typeof globalThis & {
          CaptureController?: new () => CaptureController;
        }
      ).CaptureController;
      const controller = Controller ? new Controller() : null;
      const selected = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "window", frameRate: { ideal: 2, max: 2 } },
        audio: false,
        ...(controller ? { controller } : {}),
      });
      if (!valid()) {
        selected.getTracks().forEach((track) => track.stop());
        return;
      }
      c.stream = selected;
      try {
        controller?.setFocusBehavior("no-focus-change");
      } catch {}
      const video = videoRef.current;
      if (!video) throw new Error("共有画面の表示先がありません。");
      video.srcObject = selected;
      await video.play();
      if (!valid()) return;
      selected.getVideoTracks()[0]?.addEventListener(
        "ended",
        () => {
          if (valid()) void stop();
        },
        { once: true },
      );
      c.phase = "sharing";
      setPhase("sharing");
      setMessage("画面を共有中");
      setFrames(0);
      setLastFrameAt(null);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("画像を取得できませんでした。");
      let busy = false;
      let count = 0;
      const frame = async () => {
        if (!valid() || busy || video.readyState < 2) return;
        busy = true;
        try {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          context.drawImage(video, 0, 0);
          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/jpeg", 0.86),
          );
          if (!valid()) return;
          if (!blob) throw new Error("画像を取得できませんでした。");
          const upload = new AbortController();
          c.upload = upload;
          const response = await fetch("/frame", {
            method: "POST",
            headers: {
              "Content-Type": "image/jpeg",
              "X-Capture-Source":
                selected.getVideoTracks()[0]?.getSettings().displaySurface ||
                "unknown",
            },
            body: blob,
            signal: upload.signal,
          });
          if (!valid()) return;
          if (!response.ok) throw new Error("画像の保存に失敗しました。");
          setFrames(++count);
          setError(null);
          setLastFrameAt(new Date().toISOString());
          setMessage("画面を共有中");
        } catch (error: unknown) {
          if (valid()) {
            setError(
              error instanceof Error
                ? error.message
                : "画面共有でエラーが発生しました。",
            );
            setMessage(
              error instanceof Error
                ? error.message
                : "画面共有でエラーが発生しました。",
            );
          }
        } finally {
          busy = false;
          if (valid()) c.upload = null;
        }
      };
      await frame();
      if (valid()) c.timer = setInterval(() => void frame(), 1000);
    } catch (error: unknown) {
      if (!valid()) return;
      await stop();
      if (mounted.current)
        setError(
          error instanceof Error && error.name === "NotAllowedError"
            ? null
            : error instanceof Error
              ? error.message
              : "画面共有でエラーが発生しました。",
        );
      if (mounted.current)
        setMessage(
          error instanceof Error && error.name === "NotAllowedError"
            ? "画面共有は開始されませんでした。"
            : error instanceof Error
              ? error.message
              : "画面共有でエラーが発生しました。",
        );
    }
  }, [stop]);
  useEffect(() => {
    mounted.current = true;
    const cleanup = () => {
      const wasActive = current.current.phase !== "idle";
      release();
      current.current.phase = "idle";
      if (wasActive) navigator.sendBeacon("/stop");
    };
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setPhase("idle");
      setError(null);
      setMessage("画面共有を停止しました。");
    };
    window.addEventListener("pagehide", cleanup);
    window.addEventListener("pageshow", restore);
    return () => {
      mounted.current = false;
      window.removeEventListener("pagehide", cleanup);
      window.removeEventListener("pageshow", restore);
      cleanup();
    };
  }, [release]);
  return { videoRef, phase, message, error, frames, lastFrameAt, start, stop };
}
