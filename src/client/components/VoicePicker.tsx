import { Button } from "@/components/ui/button";
import { useEffect } from "react";
import { LoaderCircle, Square, Volume2 } from "lucide-react";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { useVoiceChoices } from "../hooks/useVoiceChoices";
import type { useVoiceSession } from "../hooks/useVoiceSession";

export function VoicePicker({
  selection,
  preview,
  disabled,
}: {
  selection: ReturnType<typeof useVoiceChoices>;
  preview: ReturnType<typeof useVoiceSession>;
  disabled: boolean;
}) {
  const locked = disabled || selection.loading || !selection.choices;
  const stopPreview = preview.stop;
  useEffect(() => {
    void stopPreview();
    return () => { void stopPreview(); };
  }, [selection.selectedVoice, locked, stopPreview]);
  const previewIdle = preview.phase === "idle";
  const previewWaiting = preview.phase === "connecting" || preview.phase === "stopping";
  return (
    <FieldGroup>
      <Field orientation="horizontal" data-disabled={locked}>
        <FieldContent className="min-w-0">
          <FieldLabel htmlFor="voice-selection" className="sr-only">声</FieldLabel>
          {disabled ? <FieldDescription id="voice-help">声の変更は会話を終了してから行えます。</FieldDescription> : null}
        </FieldContent>
        <NativeSelect
          id="voice-selection"
          aria-describedby={disabled ? "voice-help" : undefined}
          value={selection.selectedVoice}
          onChange={event => selection.selectVoice(event.target.value)}
          disabled={locked}
          className="w-32 shrink-0 sm:w-40"
        >
          {selection.choices ? selection.choices.voices.map(voice => (
            <NativeSelectOption key={voice} value={voice}>
              {voice.charAt(0).toUpperCase() + voice.slice(1)}
            </NativeSelectOption>
          )) : (
            <NativeSelectOption value="">{selection.loading ? "読み込み中…" : "標準の声"}</NativeSelectOption>
          )}
        </NativeSelect>
        <Button
          variant="outline"
          disabled={locked || preview.phase === "stopping"}
          aria-label={previewIdle ? "声を試聴" : "試聴を停止"}
          title={previewIdle ? "声を試聴" : "試聴を停止"}
          aria-busy={previewWaiting}
          onClick={() => void (previewIdle ? preview.start(selection.selectedVoice) : preview.stop())}
        >
          {previewWaiting ? <LoaderCircle data-icon="inline-start" className="motion-safe:animate-spin" /> :
            !previewIdle ? <Square data-icon="inline-start" /> : <Volume2 data-icon="inline-start" />}
          {previewIdle ? "試聴" : "停止"}
        </Button>
        <audio ref={preview.audioRef} autoPlay data-voice-preview="" />
      </Field>
      {preview.error ? <FieldError>{preview.error}</FieldError> : null}
      {selection.error ? (
        <FieldError>
          {selection.error}
          <Button variant="link" size="sm" onClick={selection.retry} disabled={disabled || selection.loading}>
            再取得
          </Button>
        </FieldError>
      ) : null}
    </FieldGroup>
  );
}
