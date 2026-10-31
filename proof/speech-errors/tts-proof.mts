import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

const expected = process.env.SPEECH_PROOF_EXPECT;
assert.ok(expected === "base" || expected === "head");
assert.ok(process.env.OPENCLAW_STATE_DIR);
assert.ok(process.env.OPENCLAW_CONFIG_PATH);
process.env.OPENCLAW_DEBUG_PROXY_ENABLED = "0";
let step = "fixture-start";
const watchdog = setTimeout(() => {
  console.error(JSON.stringify({ proof: "tts", expected, step, timeout: true, ok: false }));
  process.exit(1);
}, 90_000);
let requests = 0;
let validRequests = true;
const server = createServer(async (request, response) => {
  requests += 1;
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString());
  validRequests &&= request.method === "POST" &&
    request.url?.startsWith("/v1/text-to-speech/") === true &&
    request.headers["xi-api-key"] === "synthetic-proof-key" &&
    body.text === "Synthetic speech metadata proof.";
  response.writeHead(429, { "Content-Type": "application/json", "Retry-After": "2" });
  response.end(JSON.stringify({ detail: { status: "quota_exceeded", message: "Synthetic quota failure" } }));
});

try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const cfg = {
    plugins: { enabled: true, allow: ["elevenlabs"], entries: { elevenlabs: { enabled: true } } },
    tts: {
      enabled: true, provider: "elevenlabs",
      providers: { elevenlabs: {
        apiKey: "synthetic-proof-key", baseUrl: `http://127.0.0.1:${port}`,
        voiceId: "21m00Tcm4TlvDq8ikWAM", modelId: "eleven_multilingual_v2",
      } },
    },
  };
  await mkdir(process.env.OPENCLAW_STATE_DIR, { recursive: true });
  await writeFile(process.env.OPENCLAW_CONFIG_PATH, JSON.stringify(cfg));
  step = "public-sdk-discovery";
  // Public lookup cold-loads the actual bundled catalog; no provider/registry mocks.
  const { getSpeechProvider } = await import("openclaw/plugin-sdk/speech-core");
  const provider = getSpeechProvider("elevenlabs", cfg);
  assert.equal(provider?.id, "elevenlabs");
  const { synthesizeSpeech, textToSpeechStream, textToSpeechTelephony } = await import("openclaw/plugin-sdk/tts-runtime");
  for (const mode of ["buffered", "streaming", "telephony"] as const) {
    step = `${mode}:runtime-call`;
    const before = requests;
    const params = {
      cfg, text: "Synthetic speech metadata proof.", timeoutMs: 10_000,
      prefsPath: path.join(process.env.OPENCLAW_STATE_DIR, `${mode}-preferences.json`),
      disableFallback: true,
    };
    const result = mode === "buffered" ? await synthesizeSpeech(params)
      : mode === "streaming" ? await textToSpeechStream(params)
      : await textToSpeechTelephony(params);
    step = `${mode}:consumer-assertions`;
    assert.equal(result.success, false);
    assert.equal(validRequests, true);
    assert.equal(requests - before, 1);
    assert.equal(result.attempts?.length, 1);
    const attempt = result.attempts![0]!;
    assert.equal(attempt.provider, "elevenlabs");
    assert.equal(attempt.outcome, "failed");
    assert.equal(attempt.reasonCode, "provider_error");
    assert.match(attempt.error ?? "", /429/);
    assert.equal(Reflect.get(attempt, "status"), expected === "head" ? 429 : undefined);
    assert.equal(Reflect.get(attempt, "errorCode"), expected === "head" ? "quota_exceeded" : undefined);
    assert.equal(Reflect.get(attempt, "retryAfterMs"), expected === "head" ? 2000 : undefined);
    for (const field of ["errorBody", "headers", "requestId", "cause", "stack"]) {
      assert.equal(Object.hasOwn(attempt, field), false);
    }
    console.log(JSON.stringify({
      proof: "tts", expected, mode, provider: attempt.provider, transportRequests: requests - before,
      outcome: attempt.outcome, reasonCode: attempt.reasonCode,
      status: Reflect.get(attempt, "status") ?? null,
      errorCode: Reflect.get(attempt, "errorCode") ?? null,
      retryAfterMs: Reflect.get(attempt, "retryAfterMs") ?? null,
      rawPayloadAttached: false, ok: true,
    }));
  }
  console.log(JSON.stringify({ proof: "tts", expected, scenarios: 3, requests, ok: true }));
} catch (error) {
  console.error(JSON.stringify({
    proof: "tts", expected, step, ok: false,
    error: error instanceof Error ? { name: error.name, message: error.message.replaceAll("synthetic-proof-key", "[fixture]").replace(/127\.0\.0\.1:\d+/g, "[loopback]") } : { name: "unknown" },
  }));
  process.exitCode = 1;
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  clearTimeout(watchdog);
}
