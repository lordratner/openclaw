import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { registerInternalHook } from "openclaw/plugin-sdk/hook-runtime";
import { withinTest } from "openclaw/plugin-sdk/test-fixtures";
import { describe, expect, it, vi } from "vitest";
import { createCodexNativeTestState } from "./native-app-server.test-support.js";
import {
  assertCodexThreadStartResponse,
  resolveCodexThreadRolloutPath,
} from "./protocol-validators.js";
import { isJsonObject, type JsonObject } from "./protocol.js";
import { seedRunSessionOwnerForTest } from "./run-attempt-session-owners.test-support.js";
import {
  createNativeRunParams,
  runCodexAppServerAttempt,
  setupRunAttemptTestHooks,
  tempDir,
  assistantMessage,
  userMessage,
} from "./run-attempt-test-harness.js";
import { createContextEngine } from "./run-attempt.context-engine.test-support.js";
import { createIsolatedCodexAppServerClient } from "./shared-client.js";
import {
  CODEX_HISTORY_FRAGMENT_PREFIX,
  CODEX_HISTORY_FRAGMENT_SUFFIX,
  CODEX_HISTORY_ITEM_TEXT_MAX_BYTES,
} from "./user-input.js";

function historicalFragmentText(text: string): string {
  const start = text.startsWith(CODEX_HISTORY_FRAGMENT_PREFIX)
    ? CODEX_HISTORY_FRAGMENT_PREFIX.length
    : 0;
  const end = text.endsWith(CODEX_HISTORY_FRAGMENT_SUFFIX)
    ? text.length - CODEX_HISTORY_FRAGMENT_SUFFIX.length
    : text.length;
  return text.slice(start, end);
}
import { CODEX_APP_SERVER_VERSION } from "./version.js";

setupRunAttemptTestHooks();
vi.unmock("node:child_process");

const NATIVE_FIRST_CATALOG =
  "<available_skills><skill><name>alpha-native</name><description>Creation-time catalog.</description></skill></available_skills>";

/**
 * Serves the Responses wire for the real Codex binary and records every request
 * body. `usage.tokens` is mutable so a turn can report the context pressure that
 * drives Codex's own pre-sampling auto-compaction (codex-rs/core/src/session/turn.rs
 * run_pre_sampling_compact).
 */
async function startResponsesFixture(): Promise<{
  requests: JsonObject[];
  port: number;
  usage: { tokens: number };
  close: () => Promise<void>;
}> {
  const requests: JsonObject[] = [];
  const usage = { tokens: 10 };
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      if (request.method !== "POST" || request.url !== "/v1/responses") {
        response.writeHead(404).end();
        return;
      }
      const parsed: unknown = JSON.parse(body);
      if (!isJsonObject(parsed)) {
        response.writeHead(400).end();
        return;
      }
      requests.push(parsed);
      const events = [
        { type: "response.created", response: { id: "skill-response" } },
        {
          type: "response.completed",
          response: {
            id: "skill-response",
            usage: {
              input_tokens: usage.tokens,
              output_tokens: 1,
              total_tokens: usage.tokens + 1,
            },
          },
        },
      ];
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end(
        events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
      );
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Missing loopback provider address");
  }
  return {
    requests,
    port: address.port,
    usage,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

/**
 * Writes the synthetic model catalog and provider config. `contextWindow` sets
 * the auto-compaction budget: ModelInfo::auto_compact_token_limit is
 * `context_window * 9 / 10` (codex-rs/protocol/src/openai_models.rs).
 */
async function writeCodexFixtureConfig(options: {
  root: string;
  codexHome: string;
  modelId: string;
  port: number;
  contextWindow: number;
}): Promise<void> {
  const catalogPath = path.join(options.root, "models.json");
  await fs.writeFile(
    catalogPath,
    JSON.stringify({
      models: [
        {
          slug: options.modelId,
          display_name: "Synthetic skill carrier model",
          supported_reasoning_levels: [],
          shell_type: "local",
          visibility: "list",
          supported_in_api: true,
          input_modalities: ["text", "image"],
          priority: 1,
          support_verbosity: false,
          truncation_policy: { mode: "bytes", limit: 10000 },
          experimental_supported_tools: [],
          context_window: options.contextWindow,
          model_messages: {
            instructions_template: "You are a test assistant.",
            collaboration_modes: { default: "Synthetic model-owned Default policy." },
          },
        },
      ],
    }),
  );
  await fs.writeFile(
    path.join(options.codexHome, "config.toml"),
    [
      `model=${JSON.stringify(options.modelId)}`,
      'model_provider="skill-fixture"',
      `model_catalog_json=${JSON.stringify(catalogPath)}`,
      'cli_auth_credentials_store="ephemeral"',
      'web_search="disabled"',
      'approval_policy="never"',
      'sandbox_mode="read-only"',
      "[model_providers.skill-fixture]",
      'name="Synthetic skill provider"',
      `base_url="http://127.0.0.1:${options.port}/v1"`,
      'wire_api="responses"',
      "requires_openai_auth=false",
      "supports_websockets=false",
      "request_max_retries=0",
      "stream_max_retries=0",
    ].join("\n"),
  );
}

function developerMessageText(request: JsonObject | undefined): string {
  const input = request?.input;
  if (!Array.isArray(input)) {
    return "";
  }
  return JSON.stringify(input.filter((item) => isJsonObject(item) && item.role === "developer"));
}

async function createNativeFixture(modelId: string, contextWindow = 200_000) {
  const root = await fs.realpath(tempDir);
  const native = await createCodexNativeTestState(root);
  for (const [name, value] of Object.entries(native.env)) {
    if (value !== undefined) {
      vi.stubEnv(name, value);
    }
  }
  const fixture = await startResponsesFixture();
  await writeCodexFixtureConfig({
    root,
    codexHome: native.codexHome,
    modelId,
    port: fixture.port,
    contextWindow,
  });
  const attemptOptions: Parameters<typeof runCodexAppServerAttempt>[1] = {
    pluginConfig: {
      appServer: {
        command: native.command,
        args: ["app-server"],
        homeScope: "user",
        sandbox: "read-only",
        approvalPolicy: "never",
      },
    },
    nativeHookRelay: { enabled: false },
  };
  const createParams = (filename: string, sessionKey?: string) => {
    const params = createNativeRunParams(path.join(root, filename), native.cwd, sessionKey);
    params.modelId = modelId;
    params.model = { ...params.model, id: modelId };
    params.trigger = "user";
    params.timeoutMs = 20_000;
    return params;
  };
  return { native, fixture, attemptOptions, createParams };
}

describe("native Codex skill delivery", () => {
  it("persists a complete large history seed without inference and delivers it before ordinary current input", async () => {
    const { fixture, attemptOptions, createParams } = await createNativeFixture(
      "large-history-carrier-model",
      700_000,
    );
    let client: Awaited<ReturnType<typeof createIsolatedCodexAppServerClient>> | undefined;
    let rolloutPath: string | undefined;
    let seedAcknowledged = false;
    const rawHistory = `NATIVE_HISTORY_START $historical [@historical](plugin://historical)\n${"x".repeat(1_100_000)}\nNATIVE_HISTORY_END`;
    const image = {
      type: "image" as const,
      mimeType: "image/png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
    };
    try {
      const params = createParams("large-history.jsonl");
      params.disableTools = false;
      params.config = { tools: { web: { search: { enabled: false } } } };
      params.authoredContextTokenCap = 600_000;
      params.contextTokenBudget = 500_000;
      params.prompt = "NATIVE_CURRENT_REQUEST $current";
      const historicalImageMessage = userMessage("NATIVE_IMAGE_CAPTION", 3);
      params.hostCapabilities = Object.freeze({
        ...params.hostCapabilities,
        prepareContextMedia: async ({
          message,
        }: Parameters<NonNullable<typeof params.hostCapabilities.prepareContextMedia>>[0]) => ({
          images: message === historicalImageMessage ? [image] : [],
        }),
      });
      params.contextEngine = createContextEngine({
        assemble: async () => ({
          messages: [
            { ...userMessage(rawHistory, 1), __openclaw: { senderId: "native-speaker" } },
            assistantMessage("NATIVE_ASSISTANT_BETWEEN", 2),
            historicalImageMessage,
            assistantMessage("NATIVE_ASSISTANT_AFTER_IMAGE", 4),
          ],
          estimatedTokens: 350_000,
          contextProjection: { mode: "thread_bootstrap", epoch: "native-seed-epoch" },
        }),
      });
      const result = await runCodexAppServerAttempt(params, {
        ...attemptOptions,
        clientFactory: async (options) => {
          client = await createIsolatedCodexAppServerClient(options);
          expect(client.getRuntimeIdentity()?.serverVersion).toBe(CODEX_APP_SERVER_VERSION);
          const originalRequest = client.request.bind(client);
          vi.spyOn(client, "request").mockImplementation((method, request, requestOptions) => {
            return originalRequest(method, request, requestOptions).then(async (response) => {
              if (method === "thread/start") {
                rolloutPath = resolveCodexThreadRolloutPath(
                  assertCodexThreadStartResponse(response).thread,
                );
              }
              if (
                method === "thread/inject_items" &&
                JSON.stringify(request).includes("NATIVE_HISTORY_START")
              ) {
                expect(fixture.requests).toHaveLength(0);
                expect(rolloutPath).toBeDefined();
                const persisted = await fs.readFile(rolloutPath!, "utf8");
                const rows = persisted
                  .split("\n")
                  .filter(Boolean)
                  .map((line) => JSON.parse(line) as unknown);
                const history = rows.flatMap((row) =>
                  isJsonObject(row) && row.type === "response_item" && isJsonObject(row.payload)
                    ? [row.payload]
                    : [],
                );
                const seedImageCount =
                  isJsonObject(request) && Array.isArray(request.items)
                    ? request.items.flatMap((item) =>
                        isJsonObject(item) && Array.isArray(item.content)
                          ? item.content.filter(
                              (part) => isJsonObject(part) && part.type === "input_image",
                            )
                          : [],
                      ).length
                    : 0;
                const persistedImageCount = history.flatMap((item) =>
                  Array.isArray(item.content)
                    ? item.content.filter(
                        (part) => isJsonObject(part) && part.type === "input_image",
                      )
                    : [],
                ).length;
                // Tiny diagnostics localize media loss without printing the large history.
                expect({ seedImageCount, persistedImageCount }).toEqual({
                  seedImageCount: 1,
                  persistedImageCount: 1,
                });
                const savedText = history
                  .flatMap((item) =>
                    Array.isArray(item.content)
                      ? item.content.flatMap((part) =>
                          isJsonObject(part) && typeof part.text === "string"
                            ? [historicalFragmentText(part.text)]
                            : [],
                        )
                      : [],
                  )
                  .join("");
                expect(savedText).toContain(
                  rawHistory
                    .replace("$historical", "＄historical")
                    .replace("[@historical]", "[＠historical]"),
                );
                expect(savedText).not.toContain(params.prompt);
                seedAcknowledged = true;
              }
              if (method === "turn/start") {
                expect(seedAcknowledged).toBe(true);
                expect(JSON.stringify(request)).toContain(params.prompt);
                expect(JSON.stringify(request)).not.toContain("NATIVE_HISTORY_START");
              }
              return response;
            });
          });
          return client;
        },
      });
      expect(result.terminal).toEqual({ kind: "ok" });
      expect(seedAcknowledged).toBe(true);
      expect(fixture.requests).toHaveLength(1);
      const input = fixture.requests[0]?.input;
      expect(Array.isArray(input)).toBe(true);
      const users = Array.isArray(input)
        ? input.filter((item) => isJsonObject(item) && item.role === "user")
        : [];
      const historical = users.filter((item) =>
        isJsonObject(item) && Array.isArray(item.content) && item.content.some(
          (part) => isJsonObject(part) && typeof part.text === "string" &&
            part.text.startsWith(CODEX_HISTORY_FRAGMENT_PREFIX),
        ),
      );
      const current = users.find((item) => JSON.stringify(item).includes(params.prompt));
      expect(historical.length).toBeGreaterThan(1);
      expect(current).toBeDefined();
      const content = historical.flatMap((item) => isJsonObject(item) && Array.isArray(item.content) ? item.content : []);
      for (const item of historical) {
        const textParts = isJsonObject(item) && Array.isArray(item.content)
          ? item.content.flatMap((part) => isJsonObject(part) && typeof part.text === "string" ? [part.text] : [])
          : [];
        expect(Buffer.byteLength(textParts.join(""), "utf8")).toBeLessThanOrEqual(CODEX_HISTORY_ITEM_TEXT_MAX_BYTES);
      }
      const text = content
        .flatMap((part) => (isJsonObject(part) && typeof part.text === "string" ? [historicalFragmentText(part.text)] : []))
        .join("");
      expect(text.length).toBeGreaterThan(1 << 20);
      expect(text).toContain(
        rawHistory
          .replace("$historical", "＄historical")
          .replace("[@historical]", "[＠historical]"),
      );
      expect(text).toContain('[user sender={"id":"native-speaker"}]');
      expect(text).not.toContain("truncated");
      expect(users.indexOf(historical[historical.length - 1]!)).toBeLessThan(users.indexOf(current!));
      const imageIndex = content.findIndex(
        (part) => isJsonObject(part) && part.type === "input_image",
      );
      expect(imageIndex).toBeGreaterThan(0);
      expect(content[imageIndex]).toEqual({
        type: "input_image",
        image_url: `data:${image.mimeType};base64,${image.data}`,
      });
      expect(JSON.stringify(content.slice(0, imageIndex))).toContain("NATIVE_IMAGE_CAPTION");
      expect(JSON.stringify(content.slice(imageIndex + 1))).toContain(
        "NATIVE_ASSISTANT_AFTER_IMAGE",
      );
    } finally {
      if (client) {
        expect(await client.closeAndWait()).toMatchObject({ exited: true });
      }
      await fixture.close();
    }
  }, 45_000);

  it("delivers the ordinary root catalog when model metadata owns collaboration instructions", async () => {
    const { fixture, attemptOptions, createParams } =
      await createNativeFixture("skill-carrier-model");
    let client: Awaited<ReturnType<typeof createIsolatedCodexAppServerClient>> | undefined;
    try {
      const params = createParams("session.jsonl");
      params.prompt = "What is the weather in Wilmington today?";
      const otherSkills = Array.from(
        { length: 40 },
        (_, index) =>
          `<skill><name>synthetic-${index}</name><description>${"Unrelated task capability. ".repeat(8)}</description><location>/synthetic/${index}/SKILL.md</location></skill>`,
      ).join("");
      params.skillsSnapshot = {
        prompt: `<available_skills>${otherSkills}<skill><name>weather</name><description>Current weather and forecasts.</description><location>/synthetic/weather/SKILL.md</location></skill></available_skills>`,
        skills: [],
      };
      const result = await runCodexAppServerAttempt(params, {
        ...attemptOptions,
        clientFactory: async (options) => {
          client = await createIsolatedCodexAppServerClient(options);
          return client;
        },
      });
      expect(result.terminal).toEqual({ kind: "ok" });
      expect(fixture.requests).toHaveLength(1);
      const input = fixture.requests[0]?.input;
      expect(Array.isArray(input)).toBe(true);
      const developerMessages = Array.isArray(input)
        ? input.filter((item) => isJsonObject(item) && item.role === "developer")
        : [];
      const developerText = JSON.stringify(developerMessages);
      expect(developerText).toContain("Synthetic model-owned Default policy.");
      expect(developerText).toContain(params.skillsSnapshot.prompt);
    } finally {
      if (client) {
        expect(await client.closeAndWait()).toMatchObject({ exited: true });
      }
      await fixture.close();
    }
  }, 45_000);

  it("delivers and refreshes persona through an external WebSocket Harness", async ({ signal }) => {
    const { native, fixture, createParams } = await createNativeFixture("persona-carrier-model");
    // The OS assigns the port while the native listener owns it throughout.
    // An external client must not accidentally qualify for the stdio relay.
    const harness = spawn(native.command, ["app-server", "--listen", "ws://127.0.0.1:0"], {
      cwd: native.cwd,
      env: native.env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let client: Awaited<ReturnType<typeof createIsolatedCodexAppServerClient>> | undefined;
    try {
      const listening = new Promise<string>((resolve, reject) => {
        let stderr = "";
        harness.once("error", reject);
        harness.once("exit", (code) =>
          reject(new Error(`Native WebSocket exited: ${code} ${stderr}`)),
        );
        harness.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
          const match = stderr.match(/listening on:\s*(ws:\/\/127\.0\.0\.1:\d+)/);
          if (match?.[1]) {
            resolve(match[1]);
          }
        });
      });
      const url = await withinTest(listening, signal);
      const soulPath = path.join(native.cwd, "SOUL.md");
      const firstSoul = "SYNTHETIC_REMOTE_PERSONA_FIRST";
      const editedSoul = "SYNTHETIC_REMOTE_PERSONA_EDITED";
      const sharedUser = "SYNTHETIC_SHARED_USER";
      const personalUser = "SYNTHETIC_PERSONAL_USER";
      const personalPath = path.join(native.cwd, "users", "alice", "USER.md");
      await fs.writeFile(path.join(native.cwd, "USER.md"), sharedUser);
      registerInternalHook("agent:bootstrap", (event) => {
        // Supply the same authenticated-selection metadata as the personal loader.
        const context = event.context as {
          bootstrapFiles: Array<{
            name: string;
            path: string;
            content?: string;
            missing: boolean;
            personalUser?: true;
          }>;
        };
        context.bootstrapFiles.push({
          name: "USER.md",
          path: personalPath,
          content: personalUser,
          missing: false,
          personalUser: true,
        });
      });
      const threadIds = new Set<string>();
      for (const [index, soul] of [firstSoul, editedSoul, undefined].entries()) {
        if (soul) {
          await fs.writeFile(soulPath, soul);
        } else {
          await fs.unlink(soulPath);
        }
        const params = createParams("remote-persona.jsonl");
        params.disableTools = false;
        params.runId = `remote-persona-${index}`;
        params.prompt = `Ordinary remote turn ${index}.`;
        const result = await runCodexAppServerAttempt(params, {
          pluginConfig: {
            appServer: {
              transport: "websocket",
              url,
              sandbox: "read-only",
              approvalPolicy: "never",
            },
          },
          nativeHookRelay: { enabled: false },
          clientFactory: async (options) => {
            if (!client) {
              client = await createIsolatedCodexAppServerClient(options);
              client.addNotificationHandler((notification) => {
                if (notification.method === "turn/started" && isJsonObject(notification.params)) {
                  const threadId = notification.params.threadId;
                  if (typeof threadId === "string") {
                    threadIds.add(threadId);
                  }
                }
              });
            }
            return client;
          },
        });
        expect(result.terminal).toEqual({ kind: "ok" });
        // No personal overlay may enter native history or configuration, both of
        // which can be inherited by native children (including full-history forks).
        expect(JSON.stringify(fixture.requests)).not.toContain(personalUser);
        expect(result.systemPromptReport?.injectedWorkspaceFiles).toContainEqual(
          expect.objectContaining({ path: personalPath, injectedChars: 0, truncated: false }),
        );
        const text = developerMessageText(fixture.requests.at(-1));
        expect(text).toContain(sharedUser);
        expect(text).toContain("Synthetic model-owned Default policy.");
        if (soul) {
          expect(text).toContain(soul);
          if (index === 1) {
            expect(text.lastIndexOf(editedSoul)).toBeGreaterThan(text.lastIndexOf(firstSoul));
          }
        } else {
          // Resume replaces the current section; historical turns may still
          // contain old text, so inspect the latest policy handoff.
          const latestDeveloper = fixture.requests.at(-1)?.input;
          expect(Array.isArray(latestDeveloper)).toBe(true);
          const handoffs = Array.isArray(latestDeveloper)
            ? latestDeveloper.filter(
                (item) =>
                  isJsonObject(item) &&
                  item.role === "developer" &&
                  JSON.stringify(item).includes("complete current OpenClaw"),
              )
            : [];
          expect(handoffs.length).toBeGreaterThan(0);
          expect(JSON.stringify(handoffs.at(-1))).not.toContain(editedSoul);
          expect(JSON.stringify(handoffs.at(-1))).not.toContain(firstSoul);
        }
      }
      expect(threadIds.size).toBe(1);
    } finally {
      if (client) {
        await client.closeAndWait();
      }
      if (harness.exitCode === null && harness.signalCode === null) {
        const closed = once(harness, "close");
        harness.kill("SIGTERM");
        await closed;
      }
      await fixture.close();
    }
  }, 90_000);

  it.each([
    {
      label: "a withdrawn catalog",
      refreshed: undefined,
      current: "refreshable thread instructions are empty",
    },
  ])(
    "keeps $label visible to the model after native compaction rebuilds the incognito thread",
    async ({ refreshed, current }) => {
      // auto_compact_token_limit resolves to 900, so a turn reporting 5_000
      // tokens forces the next turn to compact before it samples.
      const { fixture, attemptOptions, createParams } = await createNativeFixture(
        "skill-carrier-model",
        1_000,
      );
      const overAutoCompactLimitTokens = 5_000;
      const sessionKey = `agent:main:dashboard:incognito-native-compaction-${refreshed ? "edit" : "removal"}`;
      await seedRunSessionOwnerForTest("session-1", sessionKey);
      let client: Awaited<ReturnType<typeof createIsolatedCodexAppServerClient>> | undefined;
      try {
        const runTurn = async (runId: string, catalog: string | undefined, prompt: string) => {
          const before = fixture.requests.length;
          const params = createParams("incognito-compaction-session.jsonl", sessionKey);
          // A native-tool-restricted turn always starts a transient thread, which
          // would replace the live incognito thread this regression depends on.
          params.disableTools = false;
          params.runId = runId;
          params.prompt = prompt;
          params.timeoutMs = 60_000;
          params.skillsSnapshot = catalog ? { prompt: catalog, skills: [] } : undefined;
          const result = await runCodexAppServerAttempt(params, {
            ...attemptOptions,
            clientFactory: async (options) => {
              // One physical client across turns: an ephemeral thread has no
              // resume source, so reuse depends on this live subscription.
              client ??= await createIsolatedCodexAppServerClient(options);
              return client;
            },
          });
          expect(result.terminal).toEqual({ kind: "ok" });
          return fixture.requests.slice(before);
        };

        const [creationRequest] = await runTurn("run-1", NATIVE_FIRST_CATALOG, "first");
        expect(developerMessageText(creationRequest)).toContain(NATIVE_FIRST_CATALOG);

        fixture.usage.tokens = overAutoCompactLimitTokens;
        const [refreshRequest] = await runTurn("run-2", refreshed, "second");
        expect(developerMessageText(refreshRequest)).toContain(current);

        fixture.usage.tokens = 10;
        const compactionTurn = await runTurn("run-3", refreshed, "third");
        // Codex summarizes, then resumes the same turn against the rebuilt context.
        const summarizationIndex = compactionTurn.findIndex((request) =>
          JSON.stringify(request).includes("You are performing a CONTEXT CHECKPOINT COMPACTION."),
        );
        expect(summarizationIndex).toBeGreaterThanOrEqual(0);
        const continuationRequest = compactionTurn[summarizationIndex + 1];
        expect(continuationRequest).toBeDefined();
        // The rebuilt context restores the creation-time carrier and drops the
        // client-authored refresh, which is exactly the reversion under test.
        expect(developerMessageText(continuationRequest)).toContain(NATIVE_FIRST_CATALOG);
        expect(developerMessageText(continuationRequest)).not.toContain(current);

        const [restoredRequest] = await runTurn("run-4", refreshed, "fourth");
        const restored = developerMessageText(restoredRequest);
        expect(restored).toContain(current);
        // The creation-time catalog is immutable on an ephemeral thread, so the
        // proof is that the current catalog is the model's latest instruction.
        expect(restored.lastIndexOf(current)).toBeGreaterThan(
          restored.lastIndexOf(NATIVE_FIRST_CATALOG),
        );
      } finally {
        if (client) {
          await client.closeAndWait();
        }
        await fixture.close();
      }
    },
    180_000,
  );
});
