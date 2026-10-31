// Copy to the exact-head checkout root; execute only in the isolated GitHub proof job.
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import type {
  RealtimeTranscriptionProviderPlugin,
  RealtimeTranscriptionSession,
} from "openclaw/plugin-sdk/realtime-transcription";

const expected = process.env.SPEECH_PROOF_EXPECT;
assert.ok(expected === "base" || expected === "head", "Set SPEECH_PROOF_EXPECT=base|head");
assert.ok(process.env.OPENCLAW_STATE_DIR, "An isolated OPENCLAW_STATE_DIR is required");
assert.ok(process.env.OPENCLAW_CONFIG_PATH, "An isolated OPENCLAW_CONFIG_PATH is required");

// Provider traffic must stay on the fixture socket, never a debugging proxy.
process.env.OPENCLAW_DEBUG_PROXY_ENABLED = "0";
const cfg = {
  plugins: {
    enabled: true,
    allow: ["elevenlabs"],
    entries: { elevenlabs: { enabled: true } },
  },
};
let step = "public-sdk-lookup";
const watchdog = setTimeout(() => {
  console.error(JSON.stringify({ proof: "stt", expected, step, ok: false, timeout: true }));
  process.exit(1);
}, 60_000);

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(label)), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

type Case = "explicit-code-before-ready" | "message-type-after-ready" | "close-before-ready";

async function runCase(provider: RealtimeTranscriptionProviderPlugin, scenario: Case) {
  step = `${scenario}:listen`;
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0, maxPayload: 1024 * 1024 });
  const observed = Promise.withResolvers<Error>();
  let session: RealtimeTranscriptionSession | undefined;
  let requests = 0;
  let callbacks = 0;
  let validProviderRequest = true;
  let observedError: Error | undefined;
  let connectError: unknown;
  let assertionsPassed = false;
  const message = "Synthetic provider failure";
  const closeReason = "synthetic-close-reason-must-not-be-retained";

  server.on("connection", (socket, request) => {
    requests += 1;
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    validProviderRequest &&=
      url.pathname === "/v1/speech-to-text/realtime" &&
      url.searchParams.get("model_id") === "scribe_v2_realtime" &&
      request.headers["xi-api-key"] === "synthetic-proof-key";
    if (scenario === "close-before-ready") {
      socket.close(1011, closeReason);
    } else if (scenario === "explicit-code-before-ready") {
      socket.send(JSON.stringify({ message_type: "error", code: "rate_limited", error: message }));
    } else {
      socket.send(JSON.stringify({ message_type: "session_started" }));
      socket.send(JSON.stringify({ message_type: "input_error", message }));
    }
  });

  try {
    await bounded(once(server, "listening"), "fixture-listen-timeout");
    const { port } = server.address() as AddressInfo;
    session = provider.createSession({
      cfg,
      providerConfig: {
        apiKey: "synthetic-proof-key",
        baseUrl: `http://127.0.0.1:${port}`,
      },
      onError(error) {
        callbacks += 1;
        observed.resolve(error);
      },
    });
    step = `${scenario}:connect`;
    await bounded(session.connect(), "fixture-connect-timeout").catch((error: unknown) => {
      connectError = error;
    });
    observedError = await bounded(observed.promise, "fixture-callback-timeout");
    step = `${scenario}:consumer-assertions`;
    assert.ok(observedError instanceof Error);
    assert.equal(requests, 1);
    assert.equal(validProviderRequest, true);
    assert.equal(callbacks, 1);
    if (scenario === "message-type-after-ready") {
      assert.equal(connectError, undefined);
      assert.equal(session.isConnected(), true);
    } else {
      assert.equal(connectError, observedError);
      assert.equal(session.isConnected(), false);
    }
    if (scenario === "close-before-ready") {
      assert.equal(
        observedError.message,
        "elevenlabs realtime transcription connection closed before ready",
      );
      assert.equal(Reflect.get(observedError, "closeCode"), expected === "head" ? 1011 : undefined);
      const retainedFields = Object.getOwnPropertyNames(observedError).map((key) =>
        Reflect.get(observedError, key),
      );
      assert.equal(JSON.stringify(retainedFields).includes(closeReason), false);
    } else {
      assert.equal(observedError.message, message);
      const code = scenario === "explicit-code-before-ready" ? "rate_limited" : "input_error";
      assert.equal(Reflect.get(observedError, "errorCode"), expected === "head" ? code : undefined);
    }
    assertionsPassed = true;
  } finally {
    if (assertionsPassed) {
      step = `${scenario}:cleanup`;
    }
    session?.close();
    for (const socket of server.clients) {
      socket.terminate();
    }
    await bounded(
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
      "fixture-cleanup-timeout",
    );
  }

  assert.equal(callbacks, 1);
  console.log(
    JSON.stringify({
      proof: "stt",
      expected,
      scenario,
      provider: provider.id,
      requests,
      callbacks,
      connectRejected: connectError !== undefined,
      callbackMatchesRejection: connectError === undefined ? null : connectError === observedError,
      errorCode: observedError ? (Reflect.get(observedError, "errorCode") ?? null) : null,
      closeCode: observedError ? (Reflect.get(observedError, "closeCode") ?? null) : null,
      rawCloseReasonRetained: scenario === "close-before-ready" ? false : null,
      ok: true,
    }),
  );
}

try {
  // Cold public lookup owns discovery, registration and native capability loading.
  // Do not import the provider factory or substitute a registry/transport here.
  const { getRealtimeTranscriptionProvider } = await import(
    "openclaw/plugin-sdk/realtime-transcription"
  );
  const provider = getRealtimeTranscriptionProvider("elevenlabs", cfg);
  assert.ok(provider, "Bundled ElevenLabs provider did not resolve through the public SDK");
  assert.equal(provider.id, "elevenlabs");
  for (const scenario of [
    "explicit-code-before-ready",
    "message-type-after-ready",
    "close-before-ready",
  ] as const) {
    await runCase(provider, scenario);
  }
  console.log(JSON.stringify({ proof: "stt", expected, scenarios: 3, ok: true }));
} catch (error) {
  console.error(JSON.stringify({ proof: "stt", expected, step, ok: false, error: error instanceof Error ? { name: error.name, message: error.message.replaceAll("synthetic-proof-key", "[fixture]").replace(/127\.0\.0\.1:\d+/g, "[loopback]") } : { name: "unknown" } }));
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
}
