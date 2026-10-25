import { useCallback, useEffect, useRef, useState } from "react";
import { EventSource } from "eventsource";
import { apiFetch } from "../lib/local-api";
import type {
  VoiceDiagnostics,
  VoiceStartRequest,
} from "../../shared/contracts.js";

type Phase = "idle" | "connecting" | "connected" | "disconnected" | "stopping";
export interface Caption {
  id: number;
  role: "user" | "assistant";
  text: string;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
async function post(url: string, body: unknown): Promise<unknown> {
  const response = await apiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: url === "/voice/stop",
    signal: AbortSignal.timeout(90_000),
  });
  const result: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      record(result) && typeof result.error === "string"
        ? result.error
        : "接続できませんでした。",
    );
  return result;
}

export function useVoiceSession({ preview = false }: { preview?: boolean } = {}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mounted = useRef(true);
  const current = useRef({
    phase: "idle" as Phase,
    generation: 0,
    pc: null as RTCPeerConnection | null,
    mic: null as MediaStream | null,
    silence: null as AudioContext | null,
    events: null as EventSource | null,
    channel: null as RTCDataChannel | null,
    poll: undefined as ReturnType<typeof setInterval> | undefined,
    previewTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    pendingStart: null as Promise<unknown> | null,
    closing: null as Promise<void> | null,
  });
  const captionId = useRef(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("まだ接続していません。");
  const [error, setError] = useState<string | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [needsPlayback, setNeedsPlayback] = useState(false);
  const [lastScreenReadAt, setLastScreenReadAt] = useState<string | null>(null);
  const release = useCallback(() => {
    const c = current.current;
    ++c.generation;
    clearInterval(c.poll);
    clearTimeout(c.previewTimer);
    c.previewTimer = undefined;
    c.poll = undefined;
    c.events?.close();
    c.events = null;
    c.mic?.getTracks().forEach((track) => track.stop());
    c.mic = null;
    void c.silence?.close().catch(() => {});
    c.silence = null;
    c.pc?.close();
    c.pc = null;
    c.channel = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
    }
  }, []);
  const stop = useCallback(
    async (preserveError = false) => {
      const c = current.current;
      if (c.closing) return c.closing;
      if (c.phase === "idle") return;
      release();
      const gen = c.generation;
      c.phase = "stopping";
      if (mounted.current) {
        setPhase("stopping");
        if (!preserveError) setError(null);
        setNeedsPlayback(false);
        if (!preserveError) setMessage("会話を終了しました。");
      }
      const closing = (async () => {
        // 開始POSTが遅れて到着しても、その完了後に終了POSTを送る。
        await c.pendingStart?.catch(() => {});
        await post("/voice/stop", {}).catch(() => {});
        if (gen === c.generation) {
          c.phase = "idle";
          if (mounted.current) setPhase("idle");
        }
      })();
      c.closing = closing;
      try {
        await closing;
      } finally {
        if (c.closing === closing) c.closing = null;
      }
    },
    [release],
  );
  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    const gen = current.current.generation;
    try {
      await audio.play();
      if (mounted.current && gen === current.current.generation)
        setNeedsPlayback(false);
    } catch {
      if (mounted.current && gen === current.current.generation) {
        setNeedsPlayback(true);
        setMessage("返答音声の再生ボタンを押してください。");
      }
    }
  }, []);
  const start = useCallback(async (voice?: string) => {
    const c = current.current;
    if (c.phase !== "idle") return;
    c.phase = "connecting";
    const gen = ++c.generation;
    const valid = () => mounted.current && gen === c.generation;
    setPhase("connecting");
    setError(null);
    setNeedsPlayback(false);
    setMessage(preview ? "試聴音声を準備しています…" : "マイクの許可を確認しています…");
    try {
      let mic: MediaStream;
      if (preview) {
        // 音声接続用の無音トラック。マイクなどの入力機器は取得しません。
        const context = new AudioContext();
        c.silence = context;
        const destination = context.createMediaStreamDestination();
        const source = context.createConstantSource();
        source.offset.value = 0;
        source.connect(destination);
        source.start();
        await context.resume();
        mic = destination.stream;
      } else {
        mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: false,
        });
      }
      if (!valid()) {
        mic.getTracks().forEach((track) => track.stop());
        return;
      }
      c.mic = mic;
      const pc = new RTCPeerConnection();
      c.pc = pc;
      mic.getAudioTracks().forEach((track) => pc.addTrack(track, mic));
      pc.ontrack = (event) => {
        if (!valid()) return;
        const audio = audioRef.current;
        if (!audio) return;
        audio.srcObject = new MediaStream([event.track]);
        void audio.play().catch(() => {
          if (valid()) {
            setNeedsPlayback(true);
            setMessage("返答音声の再生ボタンを押してください。");
          }
        });
      };
      const channel = pc.createDataChannel("oai-events");
      c.channel = channel;
      channel.onopen = () => {
        if (!preview || !valid()) return;
        c.previewTimer = setTimeout(() => { if (valid()) void stop(); }, 12_000);
        void post("/voice/preview/speak", {}).catch(() => {
          if (!valid()) return;
          setError("試聴音声を再生できませんでした。");
          void stop(true);
        });
      };
      let previousEnergy = 0;
      let quietSamples = 0;
      const stats = async () => {
        if (!valid() || pc.connectionState !== "connected") return;
        try {
          let inbound: Record<string, unknown> | null = null;
          (await pc.getStats()).forEach((report: unknown) => {
            if (
              record(report) &&
              report.type === "inbound-rtp" &&
              report.kind === "audio"
            )
              inbound = report;
          });
          if (!valid()) return;
          const found = inbound as Record<string, unknown> | null;
          const diagnostics: VoiceDiagnostics = {
            connection: pc.connectionState,
            channel: channel.readyState,
            remoteTrack: pc.getReceivers().map((receiver) => ({
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
            audioPaused: audioRef.current?.paused ?? true,
            audioTime: audioRef.current?.currentTime ?? 0,
          };
          await post("/voice/diagnostics", diagnostics);
          const energy = diagnostics.inbound?.energy;
          if (preview && valid() && energy !== undefined && energy > 0) {
            quietSamples = energy <= previousEnergy + 1e-8 ? quietSamples + 1 : 0;
            previousEnergy = energy;
            if (quietSamples >= 3) void stop();
          }
        } catch {}
      };
      pc.onconnectionstatechange = () => {
        if (!valid()) return;
        if (pc.connectionState === "connected") {
          c.phase = "connected";
          setError(null);
          setPhase("connected");
          setMessage(preview ? "試聴しています。" : "接続しました。話しかけてください。");
          clearInterval(c.poll);
          c.poll = setInterval(() => void stats(), preview ? 500 : 2000);
        } else if (["failed", "disconnected"].includes(pc.connectionState)) {
          c.phase = "disconnected";
          setError(
            "接続が切れました。会話を終了してから、もう一度開始してください。",
          );
          setPhase("disconnected");
          clearInterval(c.poll);
          c.poll = undefined;
          setMessage(
            "接続が切れました。会話を終了してから、もう一度開始してください。",
          );
        }
      };
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (!valid() || typeof event.data !== "string") return;
        try {
          const value: unknown = JSON.parse(event.data);
          if (!record(value)) return;
          if (preview && value.type === "output_audio_buffer.stopped") { void stop(); return; }
          if (
            (value.type === "input_transcript.added" ||
              value.type === "output_transcript.added") &&
            record(value.item) &&
            typeof value.item.text === "string"
          ) {
            const role =
              value.type === "input_transcript.added" ? "user" : "assistant";
            const text = value.item.text;
            const id = ++captionId.current;
            setCaptions((previous) => {
              const last = previous[previous.length - 1];
              return last?.role === role
                ? [
                    ...previous.slice(0, -1),
                    { ...last, text: last.text + text },
                  ]
                : [...previous, { id, role, text }];
            });
          }
          if (value.type === "error") {
            setError(
              record(value.error) && typeof value.error.message === "string"
                ? value.error.message
                : "音声接続でエラーが発生しました。",
            );
            setMessage(
              record(value.error) && typeof value.error.message === "string"
                ? value.error.message
                : "音声接続でエラーが発生しました。",
            );
          }
        } catch {}
      };
      const events = new EventSource(
        new URL("/voice/events", location.origin),
        {
          fetch: apiFetch,
        },
      );
      c.events = events;
      events.onmessage = (event: MessageEvent<string>) => {
        if (!valid()) return;
        try {
          const value: unknown = JSON.parse(event.data);
          if (!record(value)) return;
          if (
            (value.type === "error" || value.type === "warning") &&
            typeof value.message === "string"
          ) {
            setMessage(value.message);
            if (value.type === "error") setError(value.message);
          }
          if (value.type === "screen_read") {
            setLastScreenReadAt(
              typeof value.at === "string"
                ? value.at
                : new Date().toISOString(),
            );
            setMessage("共有画面を確認しました。");
          }
          if (value.type === "closed") void stop(true);
        } catch {}
      };
      await pc.setLocalDescription(await pc.createOffer());
      if (!valid()) return;
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") {
          resolve();
          return;
        }
        const timeout = setTimeout(resolve, 2000);
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === "complete") {
            clearTimeout(timeout);
            resolve();
          }
        };
      });
      if (!valid()) return;
      const sdp = pc.localDescription?.sdp;
      if (!sdp) throw new Error("音声の接続情報を作成できませんでした。");
      setMessage("音声に接続しています…");
      const pending = post("/voice/start", { sdp, ...(voice ? { voice } : {}), ...(preview ? { preview: true } : {}) } satisfies VoiceStartRequest);
      c.pendingStart = pending;
      let response: unknown;
      try {
        response = await pending;
      } finally {
        if (c.pendingStart === pending) c.pendingStart = null;
      }
      if (!valid()) return;
      if (!record(response) || typeof response.sdp !== "string")
        throw new Error("音声の接続情報がありません。");
      await pc.setRemoteDescription({ type: "answer", sdp: response.sdp });
    } catch (error: unknown) {
      if (!valid()) return;
      const text =
        error instanceof Error && error.name === "NotAllowedError"
          ? "マイクは許可されませんでした。"
          : error instanceof Error
            ? error.message
            : "音声接続でエラーが発生しました。";
      await stop();
      if (mounted.current) setError(text);
      if (mounted.current) setMessage(text);
    }
  }, [stop, preview]);
  useEffect(() => {
    mounted.current = true;
    const cleanup = () => {
      const wasActive = current.current.phase !== "idle";
      void stop();
      if (wasActive) void post("/voice/stop", {}).catch(() => {});
    };
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setPhase(current.current.phase);
      setError(null);
      setNeedsPlayback(false);
      setMessage(
        current.current.phase === "idle"
          ? "会話を終了しました。"
          : "会話を終了しています…",
      );
    };
    window.addEventListener("pagehide", cleanup);
    window.addEventListener("pageshow", restore);
    return () => {
      mounted.current = false;
      window.removeEventListener("pagehide", cleanup);
      window.removeEventListener("pageshow", restore);
      cleanup();
    };
  }, [stop]);
  return {
    audioRef,
    phase,
    message,
    error,
    captions,
    needsPlayback,
    lastScreenReadAt,
    start,
    stop,
    play,
  };
}
