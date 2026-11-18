import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { listSubagentRunsForRequester } from "../agents/subagents/registry/subagent-registry-read.js";
import {
  expectProofIdle,
  gateway,
  proofDeliveries,
} from "./gateway.sessions-send-provenance.test-support.js";

// Opt-in real provider; only the outbound channel is a local synthetic sink.
it.runIf(Boolean(process.env.OPENCLAW_OWNER_FOLLOWUP_LIVE_MODEL))(
  "returns a real-model owner child followup result to its requester",
  async () => {
    const nonce = randomUUID();
    const sessionKey = `agent:main:owner-live-${nonce}`;
    // The synthetic channel only recognizes provenance-prefixed target IDs.
    const recipient = `provenance-owner-live-${nonce}`;
    const resultText = `CHILD_RESULT_${nonce}`;
    const waitForLiveRun = (runId: string) =>
      gateway.client.request<{ status?: string; error?: unknown }>(
        "agent.wait",
        { runId, timeoutMs: 180_000 },
        { timeoutMs: 190_000 },
      );
    const runOwner = async (message: string) => {
      const runId = randomUUID();
      await gateway.client.request(
        "agent",
        {
          sessionKey,
          message,
          idempotencyKey: runId,
          deliver: false,
          channel: "telegram",
          to: recipient,
          accountId: "default",
        },
        { expectFinal: false },
      );
      const result = await waitForLiveRun(runId);
      expect(result.status, JSON.stringify(result)).toBe("ok");
    };
    await runOwner(
      [
        "Execute this synthetic integration check using tools, not a proposal.",
        `Call sessions_spawn exactly once with ${JSON.stringify({ task: "Reply exactly INITIAL_DONE. Do not use tools.", cleanup: "keep", expectsCompletionMessage: false })}.`,
        "After acceptance, finish with CHILD_STARTED. Do not send any message.",
      ].join("\n"),
    );
    const children = listSubagentRunsForRequester(sessionKey, { requesterAgentId: "main" });
    expect(children).toHaveLength(1);
    const initial = children[0]!;
    expect(await waitForLiveRun(initial.runId)).toMatchObject({ status: "ok" });
    await expectProofIdle();
    await runOwner(
      [
        `Call sessions_send exactly once with ${JSON.stringify({ sessionKey: initial.childSessionKey, message: `Reply exactly ${resultText}. Do not use tools.`, mode: "followup", timeoutSeconds: 0 })}.`,
        "After acceptance, finish with FOLLOWUP_QUEUED. Do not send a message yet.",
        `When the completed child's result is subsequently delivered, call message exactly once with ${JSON.stringify({ action: "send", channel: "telegram", target: recipient, accountId: "default", message: resultText, final: true })}.`,
      ].join("\n"),
    );
    const followups = listSubagentRunsForRequester(sessionKey, { requesterAgentId: "main" }).filter(
      (entry) => entry.runId !== initial.runId,
    );
    expect(followups).toHaveLength(1);
    expect(await waitForLiveRun(followups[0]!.runId)).toMatchObject({ status: "ok" });
    try {
      await expect
        .poll(() => proofDeliveries(recipient), { timeout: 90_000 })
        .toEqual([{ to: recipient, text: resultText, accountId: "default" }]);
    } catch (error) {
      // Only synthetic test conversations are read; never dump config or credentials.
      const history = await gateway.client.request("chat.history", { sessionKey, limit: 30 });
      console.error("[owner-live] requester history", JSON.stringify(history));
      throw error;
    }
    await expectProofIdle();
  },
  240_000,
);
