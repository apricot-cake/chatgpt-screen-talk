import { Type, type Static } from "typebox";

export const ScreenToolInputSchema = Type.Object(
  {},
  { additionalProperties: false },
);

const VoiceIdSchema = Type.String({ pattern: "^[a-z][a-z0-9_-]{0,63}$" });
export const VoicePreviewSchema = Type.Object({}, { additionalProperties: false });
export const VoiceChoicesSchema = Type.Object({
  voices: Type.Array(VoiceIdSchema, { minItems: 1, maxItems: 128, uniqueItems: true }),
  defaultVoice: VoiceIdSchema,
}, { additionalProperties: false });
export type VoiceChoices = Static<typeof VoiceChoicesSchema>;

export const VoiceStartSchema = Type.Object(
  {
    sdp: Type.String({ pattern: "^v=0", maxLength: 200_000 }),
    voice: Type.Optional(VoiceIdSchema),
    preview: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type VoiceStartRequest = Static<typeof VoiceStartSchema>;

export const MAX_SHARED_SCREENS = 4;
export const ScreenIdSchema = Type.String({ pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" });
export const ScreenParamsSchema = Type.Object({ id: ScreenIdSchema }, { additionalProperties: false });
export const ScreenStartSchema = Type.Object({
  id: ScreenIdSchema,
  label: Type.String({ minLength: 1, maxLength: 80 }),
}, { additionalProperties: false });
export const ScreenCaptureSchema = Type.Object({
  id: ScreenIdSchema,
  label: Type.String(),
  frames: Type.Integer({ minimum: 0 }),
  lastFrameAt: Type.Union([Type.String(), Type.Null()]),
  source: Type.Union([Type.String(), Type.Null()]),
});
export type ScreenCapture = Static<typeof ScreenCaptureSchema>;
export const CaptureStatusSchema = Type.Object({
  screens: Type.Array(ScreenCaptureSchema, { maxItems: MAX_SHARED_SCREENS }),
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
