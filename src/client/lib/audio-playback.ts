/** 再生が中断されたときに再開し、ブラウザに拒否された場合だけ操作を促します。 */
export function observeAudioPlayback(
  audio: HTMLAudioElement,
  {
    isCurrent,
    onPlaying,
    onBlocked,
  }: { isCurrent(): boolean; onPlaying(): void; onBlocked(): void },
  visibility: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener"> = document,
) {
  let disposed = false;
  let pending: Promise<void> | null = null;
  const active = () => !disposed && isCurrent() && audio.srcObject !== null;
  const resume = (): Promise<void> => {
    if (!active()) return Promise.resolve();
    if (pending) return pending;
    pending = Promise.resolve().then(() => {
      if (active()) return audio.play();
    }).then(() => {
      if (active()) onPlaying();
    }, () => {
      if (active()) onBlocked();
    }).finally(() => { pending = null; });
    return pending;
  };
  const recover = () => { if (audio.paused) void resume(); };
  const visible = () => { if (visibility.visibilityState === "visible") recover(); };
  const failed = () => { if (active()) onBlocked(); };
  audio.addEventListener("pause", recover);
  audio.addEventListener("error", failed);
  visibility.addEventListener("visibilitychange", visible);
  return {
    resume,
    dispose() {
      disposed = true;
      audio.removeEventListener("pause", recover);
      audio.removeEventListener("error", failed);
      visibility.removeEventListener("visibilitychange", visible);
    },
  };
}
