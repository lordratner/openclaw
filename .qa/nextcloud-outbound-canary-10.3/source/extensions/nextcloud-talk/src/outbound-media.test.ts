import type { ChannelMessageSendMediaContext } from "openclaw/plugin-sdk/channel-outbound";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { nextcloudTalkPlugin } from "../channel-plugin-api.js";
import { withNextcloudTalkOutboundFixture as withTalk } from "./outbound-media.test-harness.js";
import type { CoreConfig } from "./types.js";

const transport = vi.hoisted(() => ({
  beforeLookup: undefined as ((url: string) => Promise<void> | void) | undefined,
}));
vi.mock("../runtime-api.js", async (original) => {
  const actual = await original<typeof import("../runtime-api.js")>();
  return {
    ...actual,
    fetchWithSsrFGuard: (params: Parameters<typeof actual.fetchWithSsrFGuard>[0]) =>
      actual.fetchWithSsrFGuard({
        ...params,
        lookupFn: async () => {
          await transport.beforeLookup?.(params.url);
          return [{ address: "127.0.0.1", family: 4 }];
        },
      }),
  };
});

let clock = 1_800_000_000_000;
beforeEach(() => {
  clock += 60_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
});
afterEach(() => {
  transport.beforeLookup = undefined;
  vi.restoreAllMocks();
});

const send = (ctx: ChannelMessageSendMediaContext) =>
  nextcloudTalkPlugin.message!.send!.media!(ctx);

it.each(["The report", ""])("delivers a real file share with caption %j", async (text) => {
  await withTalk(async ({ ctx, requests, bytes }) => {
    const result = await send({ ...ctx, text });
    const upload = requests.find(({ method }) => method === "PUT");
    expect(upload?.body).toEqual(bytes);
    expect(upload?.url.pathname).toMatch(/^\/cloud\/remote.php\/dav\/files\/canonical-user\//);
    expect(
      requests.every(
        ({ authorization }) =>
          authorization ===
          `Basic ${Buffer.from("login-alias:synthetic-app-password").toString("base64")}`,
      ),
    ).toBe(true);
    const shareRequest = requests.find(({ url }) => url.pathname.endsWith("/shares"));
    const share = new URLSearchParams(shareRequest?.body.toString());
    expect(share.get("shareType")).toBe("10");
    expect(share.get("shareWith")).toBe("allowed");
    expect(JSON.parse(share.get("talkMetaData") ?? "{}")).toEqual({ caption: text, replyTo: 41 });
    expect(share.get("referenceId")).toBeTruthy();
    expect(requests.some(({ url }) => url.pathname.includes("/bot/"))).toBe(false);
    expect(result).toMatchObject({
      messageId: "42",
      receipt: { platformMessageIds: ["42"], replyToId: "41" },
    });
    const history = requests.find(({ url }) => url.pathname.includes("/chat/"))!.url;
    expect(history.searchParams.get("setReadMarker")).toBe("0");
    expect(history.searchParams.get("noStatusUpdate")).toBe("1");
    expect(history.searchParams.get("markNotificationsAsRead")).toBe("0");
  });
});

it("requires API credentials before reading or uploading the attachment", async () => {
  await withTalk(async ({ ctx, requests }) => {
    const cfg = {
      channels: {
        "nextcloud-talk": { baseUrl: "https://cloud.invalid", botSecret: "synthetic-bot-secret" },
      },
    };
    const mediaReadFile = vi.fn(async () => Buffer.from("not read"));
    await expect(send({ ...ctx, cfg, accountId: undefined, mediaReadFile })).rejects.toThrow(
      /apiUser.*apiPassword/,
    );
    expect(mediaReadFile).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });
});

it("does not upload files outside the approved media roots", async () => {
  await withTalk(async ({ ctx, requests }) => {
    await expect(send({ ...ctx, mediaLocalRoots: [] })).rejects.toThrow();
    expect(requests.some(({ method }) => method === "PUT" || method === "MKCOL")).toBe(false);
  });
});

it("cleans an unshared upload when custody is revoked before publication", async () => {
  await withTalk(async ({ ctx, requests }) => {
    let current = true;
    transport.beforeLookup = (url) => {
      if (url.includes("/files_sharing/")) {
        current = false;
      }
    };
    await expect(
      send({
        ...ctx,
        onPlatformSendDispatch: async () => {},
        assertDirectAdapterHandoff: () => {
          if (!current) {
            throw new Error("custody revoked");
          }
        },
      }),
    ).rejects.toThrow("custody revoked");
    expect(requests.some(({ method }) => method === "PUT")).toBe(true);
    expect(requests.some(({ method }) => method === "DELETE")).toBe(true);
    expect(requests.some(({ url }) => url.pathname.endsWith("/shares"))).toBe(false);
  });
});

it("never follows an authenticated redirect", async () => {
  await withTalk(async (fixture) => {
    fixture.respond = (_, response) => {
      response.writeHead(302, { location: "/credential-leak" });
      response.end();
      return true;
    };
    await expect(send(fixture.ctx)).rejects.toThrow();
    expect(fixture.requests).toHaveLength(1);
  });
});

it.each([401, 507])("does not share after a rejected upload (%s)", async (status) => {
  await withTalk(async (fixture) => {
    fixture.respond = (request, response) => {
      if (request.method !== "PUT") {
        return false;
      }
      response.writeHead(status);
      response.end();
      return true;
    };
    await expect(send(fixture.ctx)).rejects.toThrow(/upload failed/);
    expect(fixture.requests.some(({ url }) => url.pathname.endsWith("/shares"))).toBe(false);
    expect(fixture.requests.some(({ method }) => method === "DELETE")).toBe(false);
  });
});

it("preserves the upload and reports uncertainty when no chat receipt is available", async () => {
  await withTalk(async (fixture) => {
    fixture.respond = (request, response) => {
      if (!request.url.pathname.includes("/chat/")) {
        return false;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ocs: { data: [] } }));
      return true;
    };
    await expect(send(fixture.ctx)).rejects.toThrow(/not confirmed|unknown/i);
    expect(fixture.requests.filter(({ url }) => url.pathname.endsWith("/shares"))).toHaveLength(1);
    expect(fixture.requests.some(({ method }) => method === "DELETE")).toBe(false);
  });
});

it.each([403, 500, "lost-ack"] as const)(
  "reconciles a published share despite %s without retrying",
  async (status) => {
    await withTalk(async (fixture) => {
      let referenceId = "";
      fixture.respond = (request, response) => {
        if (request.url.pathname.endsWith("/shares")) {
          referenceId = new URLSearchParams(request.body.toString()).get("referenceId") ?? "";
          if (status === "lost-ack") {
            response.destroy();
          } else {
            response.writeHead(status);
            response.end();
          }
          return true;
        }
        if (request.url.pathname.includes("/chat/")) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              ocs: {
                data: [
                  {
                    id: 42,
                    token: "allowed",
                    actorType: "users",
                    actorId: "canonical-user",
                    referenceId,
                    messageParameters: { file: { id: "81" } },
                  },
                ],
              },
            }),
          );
          return true;
        }
        return false;
      };
      await expect(send(fixture.ctx)).resolves.toMatchObject({ messageId: "42" });
      expect(fixture.requests.filter(({ url }) => url.pathname.endsWith("/shares"))).toHaveLength(
        1,
      );
      expect(fixture.requests.some(({ method }) => method === "DELETE")).toBe(false);
    });
  },
);

it("rejects oversize attachments before writing Nextcloud storage", async () => {
  await withTalk(async ({ ctx, requests }) => {
    const cfg = structuredClone(ctx.cfg) as CoreConfig;
    cfg.channels!["nextcloud-talk"]!.accounts!.work!.mediaMaxMb = 0.000001;
    await expect(send({ ...ctx, cfg })).rejects.toThrow();
    expect(requests).toEqual([]);
  });
});

it("resolves an upload without an oc-fileid header through real WebDAV XML parsing", async () => {
  await withTalk(async (fixture) => {
    fixture.respond = (request, response) => {
      if (request.method === "PUT") {
        response.writeHead(201);
        response.end();
        return true;
      }
      return false;
    };
    await expect(send(fixture.ctx)).resolves.toMatchObject({
      messageId: "42",
      receipt: { platformMessageIds: ["42"] },
    });
    expect(fixture.requests.filter(({ method }) => method === "PROPFIND")).toHaveLength(1);
    expect(fixture.requests.filter(({ url }) => url.pathname.endsWith("/shares"))).toHaveLength(1);
  });
});

it.each([
  '<oc:fileid xmlns:oc="urn:not-owncloud">81</oc:fileid>',
  '<root xmlns:oc="http://owncloud.org/ns"><oc:fileid>81</oc:fileid><oc:fileid>82</oc:fileid></root>',
  '<oc:fileid xmlns:oc="http://owncloud.org/ns">8<child/>1</oc:fileid>',
  '<oc:fileid xmlns:oc="http://owncloud.org/ns">81',
])("cleans an unshared upload rather than trusting invalid WebDAV file identity %s", async (xml) => {
  await withTalk(async (fixture) => {
    fixture.respond = (request, response) => {
      if (request.method === "PUT") {
        response.writeHead(201);
        response.end();
        return true;
      }
      if (request.method === "PROPFIND") {
        response.writeHead(207, { "content-type": "application/xml" });
        response.end(xml);
        return true;
      }
      return false;
    };
    await expect(send(fixture.ctx)).rejects.toThrow(/file identity/);
    expect(fixture.requests.some(({ url }) => url.pathname.endsWith("/shares"))).toBe(false);
    expect(fixture.requests.filter(({ method }) => method === "DELETE")).toHaveLength(1);
  });
});
