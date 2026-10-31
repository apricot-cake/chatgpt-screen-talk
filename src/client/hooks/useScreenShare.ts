import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/local-api";
import { MAX_SHARED_SCREENS } from "../../shared/contracts.js";

type Phase = "idle" | "selecting" | "sharing" | "stopping";
interface CaptureController { setFocusBehavior(value: "no-focus-change"): void }
export interface SharedScreen {
  id: string;
  label: string;
  stream: MediaStream;
  frames: number;
  lastFrameAt: string | null;
}
interface Capture extends SharedScreen {
  video: HTMLVideoElement;
  timer?: ReturnType<typeof setInterval>;
  upload?: AbortController;
}
async function selectScreen() {
  const Controller = (globalThis as typeof globalThis & { CaptureController?: new () => CaptureController }).CaptureController;
  const controller = Controller ? new Controller() : null;
  const selected = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: "window", frameRate: { ideal: 2, max: 2 } },
    audio: false,
    ...(controller ? { controller } : {}),
  });
  try { controller?.setFocusBehavior("no-focus-change"); } catch {}
  return selected;
}
function releaseCapture(capture: Capture) {
  clearInterval(capture.timer);
  capture.upload?.abort();
  capture.stream.getTracks().forEach(track => track.stop());
  capture.video.pause(); capture.video.srcObject = null;
}
async function stopRemote(id?: string) {
  const response = await apiFetch(id ? `/screens/${id}/stop` : "/screens/stop", { method: "POST", keepalive: true, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("停止を通知できませんでした。");
}
export function useScreenShare() {
  const current = useRef({ generation: 0, screens: new Map<string, Capture>(), selecting: false, stopping: false, nextLabel: 1 });
  const mounted = useRef(true);
  const [screens, setScreens] = useState<SharedScreen[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [isSelecting, setIsSelecting] = useState(false);
  const [message, setMessage] = useState("画面を共有していません。");
  const [error, setError] = useState<string | null>(null);
  const publish = useCallback(() => {
    if (!mounted.current) return;
    const c = current.current;
    setScreens([...c.screens.values()].map(({ id, label, stream, frames, lastFrameAt }) => ({ id, label, stream, frames, lastFrameAt })));
    setIsSelecting(c.selecting);
    setPhase(c.stopping ? "stopping" : c.screens.size > 0 ? "sharing" : c.selecting ? "selecting" : "idle");
  }, []);
  const stopScreen = useCallback(async (id: string) => {
    const c = current.current;
    const capture = c.screens.get(id);
    if (!capture) return;
    c.screens.delete(id); releaseCapture(capture); publish();
    try {
      await stopRemote(id);
      if (mounted.current) setMessage(c.screens.size ? "画面を共有中" : "画面共有を停止しました。");
    } catch {
      if (mounted.current) setError("画面の停止をサーバーへ通知できませんでした。接続を確認してください。");
    }
  }, [publish]);
  const stop = useCallback(async () => {
    const c = current.current;
    if (c.stopping) return;
    ++c.generation; c.stopping = true; c.selecting = false;
    c.screens.forEach(releaseCapture); c.screens.clear(); publish();
    try {
      await stopRemote();
      if (mounted.current) { setError(null); setMessage("画面共有を停止しました。"); }
    } catch {
      if (mounted.current) setError("停止をサーバーへ通知できませんでした。接続を確認してください。");
    } finally { c.stopping = false; publish(); }
  }, [publish]);
  const start = useCallback(async () => {
    const c = current.current;
    if (c.selecting || c.stopping || c.screens.size >= MAX_SHARED_SCREENS) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("このブラウザは画面共有に対応していません。ChromeまたはEdgeで開いてください。"); return;
    }
    c.selecting = true;
    const generation = c.generation;
    const valid = () => mounted.current && c.generation === generation && !c.stopping;
    publish(); setError(null); setMessage("追加する画面を選んでください。");
    let selected: MediaStream | null = null;
    let capture: Capture | undefined;
    try {
      // 各追加クリックから直接呼び、ブラウザに選択を任せます。
      selected = await selectScreen();
      if (!valid()) return;
      const video = document.createElement("video");
      video.muted = true; video.playsInline = true; video.srcObject = selected;
      capture = { id: crypto.randomUUID(), label: `画面 ${c.nextLabel++}`, stream: selected, frames: 0, lastFrameAt: null, video };
      await video.play();
      if (!valid()) return;
      if (selected.getVideoTracks()[0]?.readyState !== "live") throw new Error("選択した画面の共有が終了しました。");
      const response = await apiFetch("/screens", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: capture.id, label: capture.label }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("画面を追加できませんでした。共有を停止してからやり直してください。");
      if (!valid() || selected.getVideoTracks()[0]?.readyState !== "live") return;
      const active = capture;
      c.screens.set(active.id, active);
      selected.getVideoTracks()[0]?.addEventListener("ended", () => { void stopScreen(active.id); }, { once: true });
      selected = null;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("画像を取得できませんでした。");
      let busy = false;
      const frame = async () => {
        const exists = () => valid() && c.screens.get(active.id) === active;
        if (!exists() || busy || video.readyState < 2) return;
        busy = true;
        try {
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          context.drawImage(video, 0, 0);
          const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.86));
          if (!exists()) return;
          if (!blob) throw new Error("画像を取得できませんでした。");
          active.upload = new AbortController();
          const result = await apiFetch(`/screens/${active.id}/frame`, {
            method: "POST", headers: { "Content-Type": "image/jpeg", "X-Capture-Source": active.stream.getVideoTracks()[0]?.getSettings().displaySurface || "unknown" },
            body: blob, signal: AbortSignal.any([active.upload.signal, AbortSignal.timeout(10_000)]),
          });
          if (!exists()) return;
          if (!result.ok) throw new Error(`${active.label}の画像の保存に失敗しました。`);
          active.frames++; active.lastFrameAt = new Date().toISOString();
          publish(); setError(null); setMessage("画面を共有中");
        } catch (failure) {
          if (exists()) setError(failure instanceof Error ? failure.message : "画面の更新に失敗しました。");
        } finally { busy = false; active.upload = undefined; }
      };
      active.timer = setInterval(() => void frame(), 1000);
      publish(); setMessage("画面を共有中"); void frame();
    } catch (failure) {
      if (capture && c.screens.get(capture.id) === capture) { c.screens.delete(capture.id); releaseCapture(capture); }
      if (valid()) {
        const cancelled = failure instanceof Error && failure.name === "NotAllowedError";
        setError(cancelled ? null : failure instanceof Error ? failure.message : "画面を追加できませんでした。");
        setMessage(c.screens.size ? "画面を共有中" : "画面共有は開始されませんでした。");
      }
    } finally {
      selected?.getTracks().forEach(track => track.stop());
      if (capture && c.screens.get(capture.id) !== capture) {
        releaseCapture(capture);
        if (!c.screens.has(capture.id)) await stopRemote(capture.id).catch(() => {});
      }
      if (c.generation === generation) { c.selecting = false; publish(); }
    }
  }, [publish, stopScreen]);
  useEffect(() => {
    mounted.current = true;
    const cleanup = () => {
      const c = current.current;
      const wasActive = c.screens.size > 0 || c.selecting;
      ++c.generation; c.selecting = false;
      c.screens.forEach(releaseCapture); c.screens.clear();
      if (wasActive) void stopRemote().catch(() => {});
    };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) { publish(); setMessage("画面共有を停止しました。"); } };
    window.addEventListener("pagehide", cleanup); window.addEventListener("pageshow", restore);
    return () => { mounted.current = false; window.removeEventListener("pagehide", cleanup); window.removeEventListener("pageshow", restore); cleanup(); };
  }, [publish]);
  return { screens, phase, isSelecting, message, error, start, stop, stopScreen, maxScreens: MAX_SHARED_SCREENS };
}
