import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/local-api";
import type { VoiceChoices } from "../../shared/contracts.js";

const preferenceKey = "screen-talk-voice";
const voiceId = /^[a-z][a-z0-9_-]{0,63}$/;

function savedVoice(): string {
  try {
    const value = localStorage.getItem(preferenceKey) ?? "";
    return voiceId.test(value) ? value : "";
  } catch { return ""; }
}

function isChoices(value: unknown): value is VoiceChoices {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return Array.isArray(result.voices) && result.voices.length > 0 &&
    result.voices.length <= 128 &&
    result.voices.every(item => typeof item === "string" && voiceId.test(item)) &&
    typeof result.defaultVoice === "string" && result.voices.includes(result.defaultVoice);
}

export function useVoiceChoices() {
  const [choices, setChoices] = useState<VoiceChoices | null>(null);
  const [selectedVoice, setSelectedVoice] = useState(savedVoice);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const response = await apiFetch("/voice/choices", {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]),
        });
        const result: unknown = await response.json();
        if (!response.ok || !isChoices(result)) throw new Error();
        if (controller.signal.aborted) return;
        setChoices(result);
        setSelectedVoice(previous => result.voices.includes(previous) ? previous : result.defaultVoice);
      } catch {
        if (controller.signal.aborted) return;
        setSelectedVoice("");
        setError("声の一覧を取得できませんでした。標準の声で会話を開始できます。");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  const selectVoice = useCallback((value: string) => {
    if (!choices?.voices.includes(value)) return;
    setSelectedVoice(value);
    try { localStorage.setItem(preferenceKey, value); } catch { /* 保存できなくても会話は続けられます。 */ }
  }, [choices]);
  const retry = useCallback(() => setAttempt(previous => previous + 1), []);

  return { choices, selectedVoice, selectVoice, loading, error, retry };
}
