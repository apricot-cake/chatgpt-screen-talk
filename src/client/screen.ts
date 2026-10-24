export {};

function element<T extends Element>(
  selector: string,
  constructor: new () => T,
): T {
  const value = document.querySelector(selector);
  if (!(value instanceof constructor))
    throw new Error(`要素が見つかりません: ${selector}`);
  return value;
}

interface DisplayCaptureController {
  setFocusBehavior(behavior: "no-focus-change"): void;
}

const start = element("#start", HTMLButtonElement);
const stop = element("#stop", HTMLButtonElement);
const status = element("#status", HTMLParagraphElement);
const video = element("#preview", HTMLVideoElement);
const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");
if (!context) throw new Error("画像を取得できませんでした");
const ctx = context;
let stream: MediaStream | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let busy = false;
let count = 0;
let generation = 0;
let upload: AbortController | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "画面共有でエラーが発生しました。";
}

async function end(): Promise<void> {
  const gen = ++generation;
  clearInterval(timer);
  timer = undefined;
  upload?.abort();
  upload = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
  start.disabled = true;
  stop.disabled = true;
  status.textContent = "共有を停止しました。";
  await fetch("/stop", { method: "POST" }).catch(() => {});
  if (gen === generation) start.disabled = false;
}

async function frame(): Promise<void> {
  const current = stream;
  const gen = generation;
  if (!current || busy || video.readyState < 2) return;
  busy = true;
  try {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.86),
    );
    if (gen !== generation || current !== stream) return;
    if (!blob) throw new Error("画像を取得できませんでした");
    const controller = new AbortController();
    upload = controller;
    const response = await fetch("/frame", {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Capture-Source":
          current.getVideoTracks()[0]?.getSettings().displaySurface ||
          "unknown",
      },
      body: blob,
      signal: controller.signal,
    });
    if (gen !== generation) return;
    if (!response.ok) throw new Error("画像の保存に失敗しました");
    status.textContent = `共有中 · ${++count} 枚 · ${new Date().toLocaleTimeString("ja-JP")}`;
  } catch (error: unknown) {
    if (gen === generation) status.textContent = errorMessage(error);
  } finally {
    busy = false;
    if (gen === generation) upload = null;
  }
}

start.addEventListener("click", async () => {
  if (start.disabled) return;
  if (!navigator.mediaDevices?.getDisplayMedia) {
    status.textContent =
      "このブラウザは画面共有に対応していません。ChromeまたはEdgeで開いてください。";
    return;
  }
  const gen = ++generation;
  start.disabled = true;
  stop.disabled = false;
  try {
    const Controller = (
      globalThis as typeof globalThis & {
        CaptureController?: new () => DisplayCaptureController;
      }
    ).CaptureController;
    const controller = Controller ? new Controller() : null;
    const selected = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "window", frameRate: { ideal: 2, max: 2 } },
      audio: false,
      ...(controller ? { controller } : {}),
    });
    if (gen !== generation) {
      selected.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = selected;
    try {
      controller?.setFocusBehavior("no-focus-change");
    } catch {}
    video.srcObject = selected;
    await video.play();
    if (gen !== generation) return;
    selected.getVideoTracks()[0]?.addEventListener(
      "ended",
      () => {
        if (gen === generation) void end();
      },
      { once: true },
    );
    count = 0;
    await frame();
    if (gen === generation) timer = setInterval(() => void frame(), 1000);
  } catch (error: unknown) {
    if (gen !== generation) return;
    await end();
    status.textContent =
      error instanceof Error && error.name === "NotAllowedError"
        ? "画面共有は開始されませんでした。"
        : errorMessage(error);
  }
});
stop.addEventListener("click", () => void end());
window.addEventListener("pagehide", () => {
  ++generation;
  clearInterval(timer);
  upload?.abort();
  stream?.getTracks().forEach((track) => track.stop());
  navigator.sendBeacon("/stop");
});
