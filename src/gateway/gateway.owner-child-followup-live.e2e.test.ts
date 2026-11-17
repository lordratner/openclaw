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
    const recipient = `owner-live-${nonce}`;
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
        `When the completed child's result is subsequently delivered, send that exact result once via message(action=send, channel=telegram, target=${recipient}, final=true).`,
      ].join("\n"),
    );
    const followups = listSubagentRunsForRequester(sessionKey, { requesterAgentId: "main" }).filter(
      (entry) => entry.runId !== initial.runId,
    );
    expect(followups).toHaveLength(1);
    expect(await waitForLiveRun(followups[0]!.runId)).toMatchObject({ status: "ok" });
    await expect
      .poll(() => proofDeliveries(recipient), { timeout: 90_000 })
      .toEqual([{ to: recipient, text: resultText, accountId: "default" }]);
    await expectProofIdle();
  },
  240_000,
);
