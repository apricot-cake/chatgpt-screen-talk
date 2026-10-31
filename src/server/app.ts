import Fastify, { type FastifyError } from "fastify";
import staticFiles from "@fastify/static";
import { fastifySSE, type SSEReplyInterface } from "@fastify/sse";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CaptureStatusSchema,
  VoiceDiagnosticsSchema,
  VoiceStartSchema,
  VoiceChoicesSchema,
  VoicePreviewSchema,
  MAX_SHARED_SCREENS,
  ScreenParamsSchema,
  ScreenStartSchema,
  type ScreenCapture,
} from "../shared/contracts.js";
import createVoice, { type VoiceService } from "./voice.js";
import { createLocalAuth, type LocalAuth } from "./local-auth.js";

declare module "fastify" {
  interface FastifyContextConfig {
    public?: boolean;
  }
}

const MAX_FRAME_BYTES = 5 * 1024 * 1024;
const appRoot = fileURLToPath(new URL("../../", import.meta.url));

export interface AppOptions {
  dataDir?: string;
  clientDir?: string;
  voice?: VoiceService;
  auth?: LocalAuth;
}

export async function createApp(options: AppOptions = {}) {
  const auth = options.auth ?? createLocalAuth();
  const dataDir = path.resolve(
    options.dataDir || process.env.DATA_DIR || path.join(appRoot, ".data"),
  );
  fs.mkdirSync(dataDir, { recursive: true });
  const screens = new Map<string, { status: ScreenCapture; bytes: Buffer | null }>();
  const screenDir = path.join(dataDir, "screens");
  fs.mkdirSync(screenDir, { recursive: true });
  const captureStatus = () => ({ screens: [...screens.values()].map(screen => screen.status) });
  const saveStatus = () => fs.writeFileSync(path.join(dataDir, "status.json"), JSON.stringify(captureStatus(), null, 2));
  let voice = options.voice;
  const eventStreams = new Set<SSEReplyInterface>();
  const getVoice = () =>
    (voice ??= createVoice({
      cwd: appRoot,
      getFrames: () => [...screens.values()].flatMap(screen => screen.bytes
        ? [{ id: screen.status.id, label: screen.status.label, bytes: screen.bytes, at: screen.status.lastFrameAt }]
        : []),
    }));
  const app = Fastify({
    bodyLimit: 500_000,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    const address = app.server.address();
    if (!address || typeof address === "string") {
      return reply.code(503).send({ error: "サーバーが起動していません" });
    }
    const origin = `http://127.0.0.1:${address.port}`;
    const pathname = request.routeOptions.url;
    if (request.headers.host !== new URL(origin).host)
      return reply.code(403).send();
    if (request.method === "POST" && request.headers.origin !== origin) {
      return reply.code(403).send({ error: "許可されていない送信元です" });
    }
    if (
      pathname === "/voice/events" &&
      (request.headers["sec-fetch-site"] === "cross-site" ||
        (request.headers.origin !== undefined &&
          request.headers.origin !== origin))
    )
      return reply.code(403).send();
    if (
      !request.routeOptions.config.public &&
      !auth.accepts(request.headers.authorization)
    ) {
      return reply
        .code(401)
        .header("WWW-Authenticate", 'Bearer realm="screen-talk"')
        .send({ error: "起動時に表示されたURLからアプリを開いてください。" });
    }
    if (
      request.method === "POST" &&
      pathname === "/screens/:id/frame" &&
      request.headers["content-type"] !== "image/jpeg"
    ) {
      return reply.code(415).send({ error: "JPEG画像を送信してください" });
    }
  });

  app.setErrorHandler<FastifyError>((error, _request, reply) => {
    const statusCode =
      error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    const message = error.validation
      ? "送信内容が正しくありません"
      : error.message;
    return reply.code(statusCode).send({ error: message });
  });

  app.addContentTypeParser(
    "image/jpeg",
    { parseAs: "buffer", bodyLimit: MAX_FRAME_BYTES },
    (_request, body, done) => {
      done(null, body);
    },
  );
  await app.register(fastifySSE, { heartbeatInterval: 15_000 });
  await app.register(async (publicApp) => {
    publicApp.addHook("onRoute", (route) => {
      route.config = { ...route.config, public: true };
    });
    await publicApp.register(staticFiles, {
      root: options.clientDir || path.join(appRoot, "dist/client"),
      index: "index.html",
      dotfiles: "deny",
    });
    publicApp.get("/voice", (_request, reply) => reply.redirect("/"));
    publicApp.get("/voice.html", (_request, reply) => reply.redirect("/"));
  });
  app.get("/voice/status", () => getVoice().status());
  app.get("/voice/choices", { schema: { response: { 200: VoiceChoicesSchema } } }, () => getVoice().voices());
  app.post("/voice/preview/speak", { schema: { body: VoicePreviewSchema } }, async () => {
    await getVoice().speakPreview();
    return { ok: true };
  });
  app.get("/voice/events", { sse: "only" }, async (_request, reply) => {
    reply.sse.keepAlive();
    eventStreams.add(reply.sse);
    reply.sse.onClose(() => eventStreams.delete(reply.sse));
    await reply.sse.send({ data: { type: "status", ...getVoice().status() } });
    const unsubscribe = getVoice().subscribe((event) => {
      void reply.sse.send({ data: event }).catch(() => reply.sse.close());
    });
    reply.sse.onClose(unsubscribe);
  });
  app.post(
    "/voice/start",
    { schema: { body: VoiceStartSchema } },
    async (request) => {
      return getVoice().start(request.body.sdp, request.body.voice, request.body.preview);
    },
  );
  app.post("/voice/stop", async () => {
    await getVoice().stop();
    return { ok: true };
  });
  app.post(
    "/voice/diagnostics",
    { schema: { body: VoiceDiagnosticsSchema } },
    async (request) => {
      fs.writeFileSync(
        path.join(dataDir, "voice-diagnostics.json"),
        JSON.stringify(request.body, null, 2),
      );
      return { ok: true };
    },
  );
  app.get(
    "/status",
    { schema: { response: { 200: CaptureStatusSchema } } },
    captureStatus,
  );
  app.post("/screens", { schema: { body: ScreenStartSchema } }, (request, reply) => {
    if (screens.has(request.body.id)) return reply.code(409).send({ error: "この画面はすでに共有されています" });
    if (screens.size >= MAX_SHARED_SCREENS) return reply.code(409).send({ error: `同時に共有できる画面は${MAX_SHARED_SCREENS}つまでです` });
    screens.set(request.body.id, { status: { ...request.body, frames: 0, lastFrameAt: null, source: null }, bytes: null });
    saveStatus();
    return { ok: true };
  });
  app.get("/screens/:id/latest.jpg", { schema: { params: ScreenParamsSchema } }, (request, reply) => {
    const screen = screens.get(request.params.id);
    if (!screen?.bytes) return reply.code(404).send();
    return reply.type("image/jpeg").send(screen.bytes);
  });
  app.post("/screens/:id/stop", { schema: { params: ScreenParamsSchema } }, (request) => {
    screens.delete(request.params.id);
    saveStatus();
    return { ok: true };
  });
  app.post("/screens/stop", () => {
    screens.clear();
    saveStatus();
    return { ok: true };
  });
  app.post<{ Body: Buffer; Params: { id: string } }>(
    "/screens/:id/frame",
    { bodyLimit: MAX_FRAME_BYTES, schema: { params: ScreenParamsSchema } },
    async (request, reply) => {
      const screen = screens.get(request.params.id);
      if (!screen) return reply.code(404).send();
      const bytes = request.body;
      if (!Buffer.isBuffer(bytes) || bytes[0] !== 255 || bytes[1] !== 216)
        return reply.code(400).send();
      screen.bytes = bytes;
      screen.status = {
        ...screen.status,
        frames: screen.status.frames + 1,
        lastFrameAt: new Date().toISOString(),
        source: String(
          request.headers["x-capture-source"] || "selected-window",
        ),
      };
      fs.writeFileSync(path.join(screenDir, `${screen.status.id}.jpg`), bytes);
      saveStatus();
      return "ok";
    },
  );
  app.addHook("preClose", async () => {
    for (const stream of eventStreams) stream.close();
    eventStreams.clear();
    await voice?.stop();
  });
  return app;
}
