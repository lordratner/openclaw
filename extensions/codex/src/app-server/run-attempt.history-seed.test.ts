import path from "node:path";
import type { AgentMessage } from "openclaw/plugin-sdk/agent-core";
import { createDeferred } from "openclaw/plugin-sdk/extension-shared";
import { describe, expect, it, vi } from "vitest";
import { isJsonObject, type JsonObject } from "./protocol.js";
import {
  assistantMessage,
  setupRunAttemptTestHooks,
  tempDir,
  threadStartResult,
  userMessage,
} from "./run-attempt-test-harness.js";
import {
  createContextEngine,
  createParams,
  createStartedThreadHarness,
  getRequestInputText,
  runCodexAppServerAttempt,
} from "./run-attempt.context-engine.test-support.js";
import { readCodexAppServerBinding } from "./session-binding.test-helpers.js";

setupRunAttemptTestHooks();

const ANCHOR = "FULL_HISTORY_SEED_PREFIX";
const historyText = `${ANCHOR} $historical [@historical](plugin://history)\n${"h".repeat(1_100_000)}\nFULL_HISTORY_SEED_TAIL`;
const historicalImage = {
  type: "image" as const,
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
};

function seedParams(mode: "thread_bootstrap" | "per_turn") {
  const sessionFile = path.join(tempDir, "history-seed.jsonl");
  const params = createParams(sessionFile, path.join(tempDir, "workspace"));
  params.authoredContextTokenCap = 600_000;
  params.contextTokenBudget = 500_000;
  params.prompt = "CURRENT_REQUEST $current";
  params.currentInboundContext = { text: "CURRENT_INBOUND_REFERENCE" };
  const savedImageMessage = {
    ...userMessage("IMAGE_MESSAGE_CAPTION", 3),
    __openclaw: { senderId: "speaker-b", senderName: "Speaker B" },
  };
  const attributedHistoryMessage = {
    ...userMessage(historyText, 1),
    __openclaw: { senderId: "speaker-a", senderName: "Speaker A" },
  };
  const messages: AgentMessage[] = [
    attributedHistoryMessage,
    assistantMessage("ASSISTANT_BETWEEN_MESSAGES", 2),
    savedImageMessage,
    assistantMessage("ASSISTANT_AFTER_IMAGE", 4),
  ];
  params.hostCapabilities = Object.freeze({
    ...params.hostCapabilities,
    prepareContextMedia: async ({
      message,
    }: Parameters<NonNullable<typeof params.hostCapabilities.prepareContextMedia>>[0]) => ({
      images: message === savedImageMessage ? [historicalImage] : [],
    }),
  });
  const assemble = vi.fn(
    async (_input: Parameters<ReturnType<typeof createContextEngine>["assemble"]>[0]) => ({
      messages,
      estimatedTokens: 350_000,
      ...(mode === "thread_bootstrap"
        ? { contextProjection: { mode: "thread_bootstrap" as const, epoch: "seed-epoch-1" } }
        : {}),
    }),
  );
  params.contextEngine = createContextEngine({ assemble });
  return { params, assemble };
}

function historySeedRequests(harness: ReturnType<typeof createStartedThreadHarness>) {
  return harness.requests.filter(
    ({ method, params }) =>
      method === "thread/inject_items" && JSON.stringify(params).includes(ANCHOR),
  );
}

describe("Codex configured assembled-history delivery", () => {
  it.each(["thread_bootstrap", "per_turn"] as const)(
    "installs the complete large %s seed before publishing ready, separate from current input",
    async (mode) => {
      const { params, assemble } = seedParams(mode);
      const seedEntered = createDeferred<void>();
      const acknowledgeSeed = createDeferred<void>();
      const harness = createStartedThreadHarness(async (method, request) => {
        if (method === "thread/inject_items" && JSON.stringify(request).includes(ANCHOR)) {
          seedEntered.resolve();
          await acknowledgeSeed.promise;
          return {};
        }
        return undefined;
      });
      const run = runCodexAppServerAttempt(params);
      try {
        // The original defect reaches turn/start without a seed; fail on that
        // production boundary rather than waiting for a nonexistent fixture RPC.
        await Promise.race([seedEntered.promise, harness.waitForMethod("turn/start")]);
        expect(historySeedRequests(harness)).toHaveLength(1);
        expect(harness.requests.some(({ method }) => method === "turn/start")).toBe(false);
        expect(await readCodexAppServerBinding(params.sessionFile)).toBeUndefined();
        acknowledgeSeed.resolve();
        await run.waitForTurnAccepted();

        const seed = historySeedRequests(harness)[0]!.params as JsonObject;
        expect(seed.threadId).toBe("thread-1");
        const items = seed.items;
        expect(Array.isArray(items)).toBe(true);
        const message = Array.isArray(items) ? items[0] : undefined;
        expect(message).toMatchObject({ type: "message", role: "user" });
        const content =
          isJsonObject(message) && Array.isArray(message.content) ? message.content : [];
        expect(content.map((part) => (isJsonObject(part) ? part.type : undefined))).toEqual([
          "input_text",
          "input_image",
          "input_text",
        ]);
        const text = content
          .flatMap((part) =>
            isJsonObject(part) && typeof part.text === "string" ? [part.text] : [],
          )
          .join("");
        expect(text.length).toBeGreaterThan(1 << 20);
        expect(text).toContain(
          historyText
            .replace("$historical", "＄historical")
            .replace("[@historical]", "[＠historical]"),
        );
        expect(text).toContain('[user sender={"id":"speaker-a","name":"Speaker A"}]');
        expect(text).toContain('[user sender={"id":"speaker-b","name":"Speaker B"}]');
        expect(text).not.toContain("truncated");
        expect(text).not.toContain(params.prompt);
        expect(content[1]).toEqual({
          type: "input_image",
          image_url: `data:image/png;base64,${historicalImage.data}`,
        });
        expect(JSON.stringify(content[0])).toContain("IMAGE_MESSAGE_CAPTION");
        expect(JSON.stringify(content[2])).toContain("ASSISTANT_AFTER_IMAGE");
        const current = getRequestInputText(harness);
        expect(current).toContain(params.prompt);
        expect(current).toContain("CURRENT_INBOUND_REFERENCE");
        expect(current).not.toContain(ANCHOR);
        const assembled = assemble.mock.calls[0]?.[0];
        expect(assembled).toMatchObject({ tokenBudget: expect.any(Number) });
        expect(assembled?.tokenBudget).toBeLessThan(480_000);
        const binding = await readCodexAppServerBinding(params.sessionFile);
        expect(binding?.threadId).toBe("thread-1");
        expect(binding?.contextEngine?.projection?.epoch).toBe(
          mode === "thread_bootstrap" ? "seed-epoch-1" : undefined,
        );
      } finally {
        acknowledgeSeed.resolve();
        await run.waitForTurnAccepted();
        await harness.completeTurn();
        await run;
      }
    },
  );

  it("discards an uncertain seed and retries on a different fresh thread without advancing its epoch", async () => {
    const { params } = seedParams("thread_bootstrap");
    let starts = 0;
    let loseAcknowledgment = true;
    const acceptedSeeds: string[] = [];
    const respond = async (method: string, request: unknown) => {
      if (method === "thread/start") {
        return threadStartResult(`thread-seed-${++starts}`);
      }
      if (method === "thread/delete") {
        return {};
      }
      if (
        method === "thread/inject_items" &&
        isJsonObject(request) &&
        JSON.stringify(request).includes(ANCHOR)
      ) {
        if (typeof request.threadId !== "string") {
          throw new Error("Expected a native thread id in the history seed request");
        }
        acceptedSeeds.push(request.threadId);
        if (loseAcknowledgment) {
          throw new Error("Synthetic lost seed acknowledgment");
        }
        return {};
      }
      return undefined;
    };
    const harness = createStartedThreadHarness(respond);
    await expect(runCodexAppServerAttempt(params)).rejects.toThrow(
      "Synthetic lost seed acknowledgment",
    );
    expect(acceptedSeeds).toEqual(["thread-seed-1"]);
    expect(await readCodexAppServerBinding(params.sessionFile)).toBeUndefined();
    expect(harness.requests).toContainEqual({
      method: "thread/delete",
      params: { threadId: "thread-seed-1" },
    });
    expect(harness.requests.some(({ method }) => method === "turn/start")).toBe(false);
    loseAcknowledgment = false;
    // Failed startup retires its client; recovery must acquire a fresh transport.
    const retryHarness = createStartedThreadHarness(respond);
    const retry = runCodexAppServerAttempt({ ...params, runId: "run-seed-retry" });
    // Recording dispatch precedes installing the terminal notification projector.
    await retry.waitForTurnAccepted();
    expect(acceptedSeeds).toEqual(["thread-seed-1", "thread-seed-2"]);
    await retryHarness.completeTurn("completed", "thread-seed-2");
    await retry;
    expect((await readCodexAppServerBinding(params.sessionFile))?.threadId).toBe("thread-seed-2");
  });

  it("declines a native model mismatch before injecting the requested model's history", async () => {
    const { params } = seedParams("thread_bootstrap");
    const harness = createStartedThreadHarness(async (method) => {
      if (method === "thread/start") {
        return { ...threadStartResult(), model: "smaller-native-model" };
      }
      return method === "thread/delete" ? {} : undefined;
    });
    await expect(runCodexAppServerAttempt(params)).rejects.toThrow("different model");
    expect(historySeedRequests(harness)).toEqual([]);
    expect(await readCodexAppServerBinding(params.sessionFile)).toBeUndefined();
    expect(harness.requests.some(({ method }) => method === "turn/start")).toBe(false);
  });

  it("reuses an acknowledged bootstrap and rotates only when its projection epoch changes", async () => {
    const { params, assemble } = seedParams("thread_bootstrap");
    let starts = 0;
    const harness = createStartedThreadHarness(async (method, request) => {
      if (method === "thread/start") {
        return threadStartResult(`thread-epoch-${++starts}`);
      }
      if (method === "thread/resume" && isJsonObject(request)) {
        if (typeof request.threadId !== "string") {
          throw new Error("Expected a native thread id in the resume request");
        }
        return threadStartResult(request.threadId);
      }
      return undefined;
    });
    const runTurn = async (runId: string, threadId: string) => {
      const run = runCodexAppServerAttempt({ ...params, runId });
      await run.waitForTurnAccepted();
      await harness.completeTurn("completed", threadId);
      await run;
    };
    await runTurn("epoch-first", "thread-epoch-1");
    expect(historySeedRequests(harness)).toHaveLength(1);
    await runTurn("epoch-reuse", "thread-epoch-1");
    expect(starts).toBe(1);
    expect(historySeedRequests(harness)).toHaveLength(1);
    const previous = await assemble.mock.results[0]!.value;
    assemble.mockResolvedValue({
      ...previous,
      contextProjection: { mode: "thread_bootstrap", epoch: "seed-epoch-2" },
    });
    await runTurn("epoch-change", "thread-epoch-2");
    expect(starts).toBe(2);
    expect(historySeedRequests(harness)).toHaveLength(2);
    expect(
      (await readCodexAppServerBinding(params.sessionFile))?.contextEngine?.projection?.epoch,
    ).toBe("seed-epoch-2");
  });

  it("also seeds small configured per-turn projections on a fresh checked native thread", async () => {
    const { params } = seedParams("per_turn");
    params.contextEngine = createContextEngine({
      assemble: async () => ({ messages: [userMessage("SMALL_HISTORY", 1)], estimatedTokens: 10 }),
    });
    const harness = createStartedThreadHarness();
    const run = runCodexAppServerAttempt(params);
    await run.waitForTurnAccepted();
    expect(getRequestInputText(harness)).not.toContain("SMALL_HISTORY");
    expect(historySeedRequests(harness)).toEqual([]);
    const seed = harness.requests.find(
      ({ method, params: request }) =>
        method === "thread/inject_items" && JSON.stringify(request).includes("SMALL_HISTORY"),
    );
    expect(seed).toBeDefined();
    expect(
      harness.requests.findIndex(({ method }) => method === "thread/inject_items"),
    ).toBeLessThan(harness.requests.findIndex(({ method }) => method === "turn/start"));
    await harness.completeTurn();
    await run;
  });

  it("replaces prior native history when a configured per-turn assembly selects no messages", async () => {
    const { params } = seedParams("per_turn");
    let starts = 0;
    const harness = createStartedThreadHarness(async (method) => {
      if (method === "thread/start") {
        return threadStartResult(`thread-empty-${++starts}`);
      }
      return undefined;
    });
    const first = runCodexAppServerAttempt(params);
    await first.waitForTurnAccepted();
    await harness.completeTurn("completed", "thread-empty-1");
    await first;
    expect(historySeedRequests(harness)).toHaveLength(1);
    params.contextEngine = createContextEngine({
      assemble: async () => ({ messages: [], estimatedTokens: 0 }),
    });
    const offset = harness.requests.length;
    const empty = runCodexAppServerAttempt({ ...params, runId: "empty-projection" });
    await empty.waitForTurnAccepted();
    expect(starts).toBe(2);
    const requests = harness.requests.slice(offset);
    expect(requests.some(({ method }) => method === "thread/inject_items")).toBe(false);
    expect(requests.some(({ method }) => method === "thread/resume")).toBe(false);
    const turn = requests.find(({ method }) => method === "turn/start");
    expect(turn?.params).toMatchObject({ threadId: "thread-empty-2" });
    expect(JSON.stringify(turn?.params)).toContain(params.prompt);
    expect(JSON.stringify(turn?.params)).not.toContain(ANCHOR);
    await harness.completeTurn("completed", "thread-empty-2");
    await empty;
  });
});
