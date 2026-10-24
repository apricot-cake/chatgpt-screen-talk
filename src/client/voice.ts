import type {
  VoiceDiagnostics,
  VoiceStartRequest,
} from "../shared/contracts.js";

function element<T extends Element>(
  selector: string,
  constructor: new () => T,
): T {
  const value = document.querySelector(selector);
  if (!(value instanceof constructor))
    throw new Error(`要素が見つかりません: ${selector}`);
  return value;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "音声接続でエラーが発生しました。";
}
function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
interface VoiceStartResponse {
  sdp: string;
}
type VoiceEvent =
  | { type: "error" | "warning"; message: string }
  | { type: "screen_read" | "closed" };
function voiceEvent(value: unknown): VoiceEvent | null {
  if (!record(value)) return null;
  if (
    (value.type === "error" || value.type === "warning") &&
    typeof value.message === "string"
  )
    return { type: value.type, message: value.message };
  if (value.type === "screen_read" || value.type === "closed")
    return { type: value.type };
  return null;
}

const start = element("#start", HTMLButtonElement);
const stop = element("#stop", HTMLButtonElement);
const state = element("#state", HTMLParagraphElement);
const captions = element("#captions", HTMLParagraphElement);
const audio = element("#reply", HTMLAudioElement);
let pc: RTCPeerConnection | null = null;
let mic: MediaStream | null = null;
let eventSource: EventSource | null = null;
let voiceChannel: RTCDataChannel | null = null;
let poll: ReturnType<typeof setInterval> | undefined;
let lastRole = "";
let captionText = "";
let generation = 0;
let scrollFrame: number | null = null;

function caption(role: "user" | "assistant", text: string): void {
  const label = role === "user" ? "あなた" : "AI";
  if (lastRole !== role) {
    captionText += (captionText ? "\n" : "") + label + "：";
    lastRole = role;
  }
  captionText += text;
  captions.textContent = captionText;
  if (scrollFrame === null)
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null;
      captions.scrollIntoView({ block: "end", behavior: "auto" });
    });
}

async function post(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      record(data) && typeof data.error === "string"
        ? data.error
        : "接続できませんでした",
    );
  return data;
}
function startResponse(value: unknown): VoiceStartResponse {
  if (!record(value) || typeof value.sdp !== "string")
    throw new Error("音声の接続情報がありません。");
  return { sdp: value.sdp };
}
async function closeVoice(): Promise<void> {
  const gen = ++generation;
  clearInterval(poll);
  poll = undefined;
  eventSource?.close();
  eventSource = null;
  mic?.getTracks().forEach((track) => track.stop());
  mic = null;
  pc?.close();
  pc = null;
  voiceChannel = null;
  audio.srcObject = null;
  start.disabled = true;
  stop.disabled = true;
  state.textContent = "会話を終了しました。";
  await post("/voice/stop", {}).catch(() => {});
  if (gen === generation) start.disabled = false;
}
async function stats(): Promise<void> {
  const connection = pc;
  if (!connection || connection.connectionState !== "connected") return;
  try {
    let inbound: Record<string, unknown> | null = null;
    (await connection.getStats()).forEach((report: unknown) => {
      if (
        record(report) &&
        report.type === "inbound-rtp" &&
        report.kind === "audio"
      )
        inbound = report;
    });
    const found = inbound as Record<string, unknown> | null;
    const diagnostics: VoiceDiagnostics = {
      connection: connection.connectionState,
      channel: voiceChannel?.readyState,
      remoteTrack: connection
        .getReceivers()
        .map((receiver) => ({
          kind: receiver.track.kind,
          muted: receiver.track.muted,
          state: receiver.track.readyState,
        })),
      inbound: found
        ? {
            packets: numeric(found.packetsReceived),
            bytes: numeric(found.bytesReceived),
            samples: numeric(found.totalSamplesReceived),
            energy: numeric(found.totalAudioEnergy),
          }
        : null,
      audioPaused: audio.paused,
      audioTime: audio.currentTime,
    };
    await post("/voice/diagnostics", diagnostics);
  } catch {}
}

start.addEventListener("click", async () => {
  if (start.disabled) return;
  start.disabled = true;
  stop.disabled = false;
  state.textContent = "マイクの許可を確認しています…";
  const gen = ++generation;
  try {
    const selected = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    if (gen !== generation) {
      selected.getTracks().forEach((track) => track.stop());
      return;
    }
    mic = selected;
    const connection = new RTCPeerConnection();
    pc = connection;
    selected
      .getAudioTracks()
      .forEach((track) => connection.addTrack(track, selected));
    connection.ontrack = (event) => {
      if (gen !== generation) return;
      audio.srcObject = new MediaStream([event.track]);
      void audio.play().catch(() => {
        if (gen !== generation) return;
        state.textContent =
          "返答音声を再生するため、下の再生ボタンを押してください。";
        audio.controls = true;
      });
    };
    connection.onconnectionstatechange = () => {
      if (gen !== generation) return;
      if (connection.connectionState === "connected") {
        state.textContent = "接続しました。マイクに話しかけてください。";
        clearInterval(poll);
        poll = setInterval(() => void stats(), 2000);
      } else if (
        ["failed", "disconnected"].includes(connection.connectionState)
      )
        state.textContent =
          "接続が切れました。終了してから、もう一度開始してください。";
    };
    const channel = connection.createDataChannel("oai-events");
    voiceChannel = channel;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (gen !== generation || typeof event.data !== "string") return;
      try {
        const value: unknown = JSON.parse(event.data);
        if (!record(value)) return;
        if (
          (value.type === "output_transcript.added" ||
            value.type === "input_transcript.added") &&
          record(value.item) &&
          typeof value.item.text === "string"
        )
          caption(
            value.type === "input_transcript.added" ? "user" : "assistant",
            value.item.text,
          );
        if (value.type === "error")
          state.textContent =
            record(value.error) && typeof value.error.message === "string"
              ? value.error.message
              : "音声接続でエラーが発生しました。";
      } catch {}
    };
    const events = new EventSource("/voice/events");
    eventSource = events;
    events.onmessage = (event: MessageEvent<string>) => {
      if (gen !== generation) return;
      try {
        const value = voiceEvent(JSON.parse(event.data) as unknown);
        if (!value) return;
        if (value.type === "error" || value.type === "warning")
          state.textContent = value.message;
        if (value.type === "screen_read")
          state.textContent = "共有画面を確認しました。";
        if (value.type === "closed") void closeVoice();
      } catch {}
    };
    const offer = await connection.createOffer();
    if (gen !== generation) return;
    await connection.setLocalDescription(offer);
    await new Promise<void>((resolve) => {
      if (connection.iceGatheringState === "complete") {
        resolve();
        return;
      }
      const timeout = setTimeout(resolve, 2000);
      connection.onicegatheringstatechange = () => {
        if (connection.iceGatheringState === "complete") {
          clearTimeout(timeout);
          resolve();
        }
      };
    });
    if (gen !== generation) return;
    const sdp = connection.localDescription?.sdp;
    if (!sdp) throw new Error("音声の接続情報を作成できませんでした。");
    state.textContent = "音声に接続しています…";
    const result = startResponse(
      await post("/voice/start", { sdp } satisfies VoiceStartRequest),
    );
    if (gen !== generation) return;
    await connection.setRemoteDescription({ type: "answer", sdp: result.sdp });
  } catch (error: unknown) {
    if (gen !== generation) return;
    const message =
      error instanceof Error && error.name === "NotAllowedError"
        ? "マイクは許可されませんでした。"
        : errorMessage(error);
    await closeVoice();
    state.textContent = message;
  }
});
stop.addEventListener("click", () => void closeVoice());
window.addEventListener("pagehide", () => {
  ++generation;
  clearInterval(poll);
  eventSource?.close();
  mic?.getTracks().forEach((track) => track.stop());
  pc?.close();
  if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
  navigator.sendBeacon("/voice/stop", "{}");
});
