import { Type, type Static } from "typebox";

export const ScreenToolInputSchema = Type.Object(
  {},
  { additionalProperties: false },
);

export const VoiceStartSchema = Type.Object(
  { sdp: Type.String({ pattern: "^v=0", maxLength: 200_000 }) },
  { additionalProperties: false },
);
export type VoiceStartRequest = Static<typeof VoiceStartSchema>;

export const CaptureStatusSchema = Type.Object({
  frames: Type.Integer({ minimum: 0 }),
  lastFrameAt: Type.Union([Type.String(), Type.Null()]),
  source: Type.Union([Type.String(), Type.Null()]),
  active: Type.Boolean(),
});
export type CaptureStatus = Static<typeof CaptureStatusSchema>;

const OptionalNumber = Type.Optional(Type.Number());
export const VoiceDiagnosticsSchema = Type.Object(
  {
    connection: Type.String({ maxLength: 100 }),
    channel: Type.Optional(Type.String({ maxLength: 100 })),
    remoteTrack: Type.Array(
      Type.Object({
        kind: Type.String({ maxLength: 100 }),
        muted: Type.Boolean(),
        state: Type.String({ maxLength: 100 }),
      }),
      { maxItems: 10 },
    ),
    inbound: Type.Union([
      Type.Object({
        packets: OptionalNumber,
        bytes: OptionalNumber,
        samples: OptionalNumber,
        energy: OptionalNumber,
      }),
      Type.Null(),
    ]),
    audioPaused: Type.Boolean(),
    audioTime: Type.Number(),
  },
  { additionalProperties: false },
);
export type VoiceDiagnostics = Static<typeof VoiceDiagnosticsSchema>;
