import { test } from "node:test";
import assert from "node:assert/strict";
import { observeAudioPlayback } from "../src/client/lib/audio-playback.js";

class AudioStub extends EventTarget {
  srcObject: unknown = {};
  paused = true;
  calls = 0;
  rejected = false;
  async play() {
    this.calls++;
    if (this.rejected) throw new Error("autoplay blocked");
    this.paused = false;
  }
}
class VisibilityStub extends EventTarget { visibilityState: DocumentVisibilityState = "visible"; }
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test("再生中断を再開し、拒否された場合は操作を促して手動で再試行できる", async () => {
  const audio = new AudioStub();
  const visibility = new VisibilityStub();
  let blocked = 0, playing = 0;
  const playback = observeAudioPlayback(audio as unknown as HTMLAudioElement, {
    isCurrent: () => true,
    onBlocked: () => blocked++,
    onPlaying: () => playing++,
  }, visibility);
  audio.rejected = true;
  audio.dispatchEvent(new Event("pause"));
  audio.dispatchEvent(new Event("pause"));
  await flush();
  assert.equal(audio.calls, 1);
  assert.equal(blocked, 1);
  audio.rejected = false;
  await playback.resume();
  assert.equal(audio.calls, 2);
  assert.equal(playing, 1);
  assert.equal(audio.paused, false);
  playback.dispose();
});

test("タブ復帰時に停止した再生だけを再開し、終了後は再生しない", async () => {
  const audio = new AudioStub();
  const visibility = new VisibilityStub();
  const playback = observeAudioPlayback(audio as unknown as HTMLAudioElement, {
    isCurrent: () => true, onBlocked() {}, onPlaying() {},
  }, visibility);
  visibility.visibilityState = "hidden";
  visibility.dispatchEvent(new Event("visibilitychange"));
  await flush();
  assert.equal(audio.calls, 0);
  visibility.visibilityState = "visible";
  visibility.dispatchEvent(new Event("visibilitychange"));
  await flush();
  assert.equal(audio.calls, 1);
  visibility.dispatchEvent(new Event("visibilitychange"));
  await flush();
  assert.equal(audio.calls, 1);
  playback.dispose();
  audio.paused = true;
  audio.dispatchEvent(new Event("pause"));
  await playback.resume();
  assert.equal(audio.calls, 1);
});

test("終了後に遅れて再生が失敗しても次の会話の表示を更新しない", async () => {
  const audio = new AudioStub();
  let reject!: (error: Error) => void;
  audio.play = () => new Promise<never>((_, failure) => { reject = failure; });
  let notified = false;
  const playback = observeAudioPlayback(audio as unknown as HTMLAudioElement, {
    isCurrent: () => true, onBlocked() { notified = true; }, onPlaying() { notified = true; },
  }, new VisibilityStub());
  const pending = playback.resume();
  await Promise.resolve();
  playback.dispose();
  reject(new Error("late rejection"));
  await pending;
  assert.equal(notified, false);
});
