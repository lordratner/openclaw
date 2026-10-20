// Nextcloud Talk plugin module owns webhook ingress identity and legacy-state migration.
import type { ChannelIngressQueue } from "openclaw/plugin-sdk/channel-outbound";
import { isRecord } from "openclaw/plugin-sdk/channel-secret-basic-runtime";
import type { NextcloudTalkInboundQuote } from "./types.js";

export const NEXTCLOUD_TALK_INGRESS_PAYLOAD_VERSION = 1;

export type NextcloudTalkIngressPayload = {
  version: 1;
  receivedAt: number;
  rawEvent: string;
};

export type NextcloudTalkLegacyReplayEntry = {
  key: string;
  seenAt: number;
};

export type NextcloudTalkLegacyReplayStore = {
  entries: () => Promise<Array<{ value: NextcloudTalkLegacyReplayEntry }>>;
  clear: () => Promise<void>;
};

export class NextcloudTalkWebhookPayloadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NextcloudTalkWebhookPayloadError";
  }
}

export function parseRawObject(rawEvent: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawEvent);
  } catch (error) {
    throw new NextcloudTalkWebhookPayloadError("Nextcloud Talk webhook contains invalid JSON.", {
      cause: error,
    });
  }
  if (!isRecord(parsed)) {
    throw new NextcloudTalkWebhookPayloadError("Nextcloud Talk webhook must be a JSON object.");
  }
  return parsed;
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  throw new NextcloudTalkWebhookPayloadError(`Nextcloud Talk webhook is missing ${field}.`);
}

/** Read one optional signed parent without rejecting an otherwise valid current message. */
export function parseNextcloudTalkQuotedReply(
  envelope: Record<string, unknown>,
): NextcloudTalkInboundQuote | undefined {
  const object = isRecord(envelope.object) ? envelope.object : null;
  const quote = isRecord(object?.inReplyTo) ? object.inReplyTo : null;
  const actor = isRecord(quote?.actor) ? quote.actor : null;
  const parent = isRecord(quote?.object) ? quote.object : null;
  if (
    quote?.type !== "Note" ||
    actor?.type !== "Person" ||
    typeof actor.id !== "string" ||
    !actor.id.trim() ||
    typeof actor.name !== "string" ||
    parent?.type !== "Note" ||
    typeof parent.id !== "string" ||
    !parent.id.trim() ||
    typeof parent.content !== "string"
  ) {
    return undefined;
  }

  let body = parent.content;
  let structured: unknown;
  try {
    structured = JSON.parse(body);
  } catch {
    // Plain text is supported alongside Talk's JSON-encoded rich strings.
  }
  if (isRecord(structured)) {
    const parameters: Record<string, unknown> | undefined = isRecord(structured.parameters)
      ? structured.parameters
      : Array.isArray(structured.parameters) && structured.parameters.length === 0
        ? {}
        : undefined;
    if (typeof structured.message !== "string" || !parameters) {
      return undefined;
    }
    body = structured.message.replace(/\{([^{}]+)\}/gu, (placeholder, key: string) => {
      const parameter = Object.hasOwn(parameters, key) ? parameters[key] : undefined;
      return isRecord(parameter) && typeof parameter.name === "string"
        ? parameter.name
        : placeholder;
    });
  } else if (Array.isArray(structured)) {
    return undefined;
  }
  return {
    id: parent.id.trim(),
    senderId: actor.id.trim(),
    senderName: actor.name,
    body,
  };
}

export function inspectNextcloudTalkWebhookEnvelope(
  rawEvent: string,
): { eventId: string; laneKey: string } | null {
  const envelope = parseRawObject(rawEvent);
  if (envelope.type !== "Create") {
    return null;
  }
  const object = isRecord(envelope.object) ? envelope.object : null;
  if (object?.type !== undefined && object.type !== "Note") {
    return null;
  }
  if (!object) {
    throw new NextcloudTalkWebhookPayloadError("Nextcloud Talk webhook is missing object.");
  }
  const target = isRecord(envelope.target) ? envelope.target : null;
  return {
    eventId: requiredString(object.id, "object.id"),
    laneKey: `room:${requiredString(target?.id, "target.id")}`,
  };
}

function parseLegacyReplayKey(key: string): { messageId: string; roomId: string } | null {
  const separator = key.lastIndexOf(":");
  const roomId = key.slice(0, separator).trim();
  const messageId = key.slice(separator + 1).trim();
  return separator > 0 && roomId && messageId ? { messageId, roomId } : null;
}

/** Convert the shipped replay guard's live window into durable completion tombstones. */
export async function migrateNextcloudTalkLegacyReplayState(params: {
  queue: ChannelIngressQueue<NextcloudTalkIngressPayload>;
  store: NextcloudTalkLegacyReplayStore;
}): Promise<number> {
  const entries = await params.store.entries();
  let migrated = 0;
  for (const entry of entries) {
    const identity = parseLegacyReplayKey(entry.value.key);
    if (!identity || !Number.isFinite(entry.value.seenAt)) {
      continue;
    }
    const marker: NextcloudTalkIngressPayload = {
      version: NEXTCLOUD_TALK_INGRESS_PAYLOAD_VERSION,
      receivedAt: entry.value.seenAt,
      rawEvent: "",
    };
    const result = await params.queue.enqueue(identity.messageId, marker, {
      receivedAt: entry.value.seenAt,
      laneKey: `room:${identity.roomId}`,
    });
    const ownsMarker =
      result.kind === "accepted" ||
      (result.kind === "pending" && result.record.payload.rawEvent === "");
    if (ownsMarker) {
      const completed = await params.queue.complete(identity.messageId, {
        completedAt: entry.value.seenAt,
      });
      if (!completed) {
        throw new Error(`Failed to migrate Nextcloud Talk replay key ${entry.value.key}.`);
      }
    }
    // Any existing ingress row already rejects the retired guard's duplicate.
    migrated += 1;
  }
  await params.store.clear();
  return migrated;
}
