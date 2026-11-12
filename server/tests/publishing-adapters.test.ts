import { describe, expect, it, vi } from "vitest";
import { BufferService, type BufferChannel } from "../src/services/publishing/buffer.service.js";
import { WordPressService } from "../src/services/publishing/wordpress.service.js";
import { studioDocument } from "./studio-fixtures.js";

const channel: BufferChannel = {
  id: "social",
  name: "Brand",
  platform: "x",
  reminders: false,
  hasDevice: true,
  disconnected: false,
  locked: false,
  paused: false,
};
const credentials = {
  siteUrl: "https://cms.example.com",
  username: "editor",
  applicationPassword: "application-secret",
};
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

describe("Buffer GraphQL publishing", () => {
  it("uses the supported createPost operation for scheduling, media and complete X threads", async () => {
    const transport = vi.fn().mockResolvedValue(
      json({
        data: {
          createPost: {
            __typename: "PostActionSuccess",
            post: { id: "remote", status: "scheduled" },
          },
        },
      }),
    );
    const service = new BufferService(transport);
    const document = studioDocument();
    await service.schedulePost("secret", {
      channel,
      document,
      media: [],
      schedulingType: "automatic",
      dueAt: "2026-12-01T10:00:00Z",
    });
    const [url, request] = transport.mock.calls[0]!;
    expect(url).toBe("https://api.buffer.com");
    expect(request.redirect).toBe("error");
    const payload = JSON.parse(request.body);
    expect(payload.query).toContain("createPost(input:$input)");
    expect(payload.variables.input).toMatchObject({
      channelId: "social",
      assets: [],
      needsApproval: false,
      schedulingType: "automatic",
      mode: "customScheduled",
      dueAt: "2026-12-01T10:00:00Z",
      text: document.content.x.thread[0],
    });
    expect(payload.variables.input.metadata.twitter.thread).toEqual(
      document.content.x.thread.map((text) => ({ text })),
    );
  });
  it("requires an active mobile device for reminder-only accounts", async () => {
    const transport = vi.fn();
    await expect(
      new BufferService(transport).createPost("secret", {
        channel: { ...channel, platform: "instagram", reminders: true, hasDevice: false },
        document: studioDocument(),
        media: [],
        schedulingType: "automatic",
      }),
    ).rejects.toMatchObject({ code: "BUFFER_MOBILE_DEVICE_REQUIRED" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("honors provider rate limits and marks ambiguous creates for reconciliation", async () => {
    const rate = new BufferService(
      vi
        .fn()
        .mockResolvedValue(new Response("", { status: 429, headers: { "Retry-After": "90" } })),
    );
    const input = {
      channel,
      document: studioDocument(),
      media: [],
      schedulingType: "automatic" as const,
    };
    await expect(rate.createPost("secret", input)).rejects.toMatchObject({
      retryAfter: 90,
      uncertain: false,
    });
    await expect(
      new BufferService(
        vi.fn().mockRejectedValue(new Error("credential-bearing error")),
      ).createPost("secret", input),
    ).rejects.toMatchObject({ code: "BUFFER_NETWORK_ERROR", uncertain: true });
    const ambiguous = new BufferService(
      vi.fn().mockResolvedValue(json({ data: { createPost: { __typename: "RestProxyError" } } })),
    );
    await expect(ambiguous.createPost("secret", input)).rejects.toMatchObject({ uncertain: true });
  });
  it("discovers only supported channels and preserves reminder eligibility", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(json({ data: { account: { organizations: [{ id: "org" }] } } }))
      .mockResolvedValueOnce(
        json({
          data: {
            channels: [
              {
                id: "ig",
                name: "Personal IG",
                service: "instagram",
                type: "profile",
                isDisconnected: false,
                isLocked: false,
                isQueuePaused: false,
                hasActiveMemberDevice: true,
                metadata: { defaultToReminders: true },
              },
            ],
          },
        }),
      );
    expect(await new BufferService(transport).channels("secret")).toEqual([
      expect.objectContaining({ platform: "instagram", reminders: true, hasDevice: true }),
    ]);
  });
  it("uses valid YouTube metadata and public video asset URLs", async () => {
    const transport = vi.fn().mockResolvedValue(
      json({
        data: {
          createPost: {
            __typename: "PostActionSuccess",
            post: { id: "remote", status: "sending" },
          },
        },
      }),
    );
    await new BufferService(transport).createPost("secret", {
      channel: { ...channel, platform: "youtube" },
      document: studioDocument(),
      media: [{ public_url: "https://media.example/video.mp4", mime_type: "video/mp4" }],
      schedulingType: "automatic",
    });
    const input = JSON.parse(transport.mock.calls[0]![1].body).variables.input;
    expect(input.metadata.youtube).toMatchObject({
      privacy: "public",
      categoryId: "27",
      madeForKids: false,
    });
    expect(input.assets).toEqual([{ video: { url: "https://media.example/video.mp4" } }]);
    expect(input.mode).toBe("shareNow");
  });
});

describe("WordPress publishing with JSON-LD", () => {
  it("publishes escaped article HTML and verifies stored schema metadata", async () => {
    const document = studioDocument();
    document.content.blog.sections[0]!.body = '<script>alert("x")</script>';
    const transport = vi
      .fn()
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ id: 1 }))
      .mockResolvedValueOnce(
        json({ schema: { properties: { meta: { properties: { savoir_schema_json: {} } } } } }),
      )
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(init.body);
        expect(body.content).toContain("&lt;script&gt;");
        expect(body.content).not.toContain("<script>");
        expect(body.status).toBe("publish");
        expect(JSON.parse(body.meta.savoir_schema_json)["@type"]).toBe("Article");
        return json({
          id: 12,
          link: "https://cms.example.com/article",
          status: "publish",
          meta: body.meta,
        });
      });
    const result = await new WordPressService(transport).publish(credentials, document, "delivery");
    expect(result.id).toBe(12);
    expect(transport.mock.calls[3]![1].headers.Authorization).toMatch(/^Basic /);
  });
  it("refuses publication when the JSON-LD plugin is missing", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ id: 1 }))
      .mockResolvedValueOnce(json({ schema: { properties: {} } }));
    await expect(
      new WordPressService(transport).publish(credentials, studioDocument(), "delivery"),
    ).rejects.toMatchObject({ code: "WORDPRESS_SCHEMA_PLUGIN_REQUIRED" });
    expect(transport.mock.calls.some((call) => call[1].method === "POST")).toBe(false);
  });
  it("requires reconciliation when a published post lost schema metadata", async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(
        json([{ id: 1, status: "publish", link: "https://cms.example.com/article", meta: {} }]),
      );
    await expect(
      new WordPressService(transport).publish(credentials, studioDocument(), "delivery"),
    ).rejects.toMatchObject({ code: "CMS_EXISTING_SCHEMA_MISMATCH", uncertain: true });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
