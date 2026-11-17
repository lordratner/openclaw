import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  expectProofIdle,
  gateway,
  proofDeliveries,
  proofSend,
  proofSpawn,
  registerProofModelScript,
  waitForProofRun,
} from "./gateway.sessions-send-provenance.test-support.js";

// Real token-authenticated WS ingress, agent/model transport, native child tools,
// completion wake, and outbound delivery. Only provider and channel I/O are fixtures.
it("delivers a completed child's followup result to its authenticated owner requester", async () => {
  const marker = "owner_child_followup";
  const sessionKey = `agent:main:${marker}`;
  const recipient = "provenance-owner-child-followup";
  const childReply = `${marker}_CHILD_RESULT`;
  const delivered = `${marker}_REQUESTER_RECEIVED`;
  let spawn: Record<string, unknown> | undefined;
  let followup: Record<string, unknown> | undefined;
  let spawnSourceCalls = 0;
  let sendSourceCalls = 0;
  let initialCalls = 0;
  let followupCalls = 0;
  let completionCalls = 0;
  registerProofModelScript(marker, (request) => {
    if (request.prompt.includes(childReply)) {
      completionCalls += 1;
      return completionCalls === 1
        ? { tool: { name: "message", args: { action: "send", channel: "telegram", target: recipient, message: delivered, final: true } } }
        : { text: "NO_REPLY" };
    }
    if (request.prompt.includes(`${marker}_CHILD_FOLLOWUP`)) {
      followupCalls += 1;
      return { text: childReply };
    }
    if (request.prompt.includes(`${marker}_CHILD_INITIAL`)) {
      initialCalls += 1;
      return { text: `${marker}_INITIAL_DONE` };
    }
    if (request.prompt.includes(`${marker}_SEND`)) {
      sendSourceCalls += 1;
      if (sendSourceCalls === 1) {
        return proofSend(spawn?.childSessionKey, `${marker}_CHILD_FOLLOWUP`, "followup");
      }
      followup = request.result;
      return { text: `${marker}_QUEUED` };
    }
    spawnSourceCalls += 1;
    if (spawnSourceCalls === 1) {
      return proofSpawn(`${marker}_CHILD_INITIAL`, { expectsCompletionMessage: false });
    }
    spawn = request.result;
    return { text: `${marker}_SPAWNED` };
  });
  const runOwner = async (message: string) => {
    const runId = randomUUID();
    await gateway.client.request("agent", {
      sessionKey,
      message,
      idempotencyKey: runId,
      deliver: false,
    }, { expectFinal: false });
    expect(await waitForProofRun(runId)).toMatchObject({ status: "ok" });
  };
  await runOwner(`${marker}_START`);
  expect(spawn).toMatchObject({ status: "accepted", childSessionKey: expect.any(String), runId: expect.any(String) });
  expect(await waitForProofRun(spawn?.runId)).toMatchObject({ status: "ok" });
  await expectProofIdle();
  expect(initialCalls).toBeGreaterThan(0);
  await runOwner(`${marker}_SEND`);
  expect(followup).toMatchObject({ status: "accepted", runId: expect.any(String) });
  expect(await waitForProofRun(followup?.runId)).toMatchObject({ status: "ok" });
  await expectProofIdle();
  expect(followupCalls).toBeGreaterThan(0);
  expect(completionCalls).toBeGreaterThan(0);
  expect(proofDeliveries(recipient)).toEqual([{ to: recipient, text: delivered, accountId: "default" }]);
}, 120_000);
