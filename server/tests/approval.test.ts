import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  ApprovalService,
  requireRevision,
  validateTargetMedia,
  type DraftRecord,
} from "../src/services/publishing/approval.service.js";
import { projectId, studioDocument } from "./studio-fixtures.js";
import { TokenCrypto } from "../src/services/integrations/token-crypto.js";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/db/tenant.js", () => ({
  withTenantClient: async (
    _pool: unknown,
    _context: unknown,
    operation: (client: unknown) => unknown,
  ) => operation({ query: mocks.query }),
}));
const draft = (status: DraftRecord["status"] = "draft"): DraftRecord => ({
  id: projectId,
  project_id: projectId,
  tenant_id: projectId,
  document: studioDocument(),
  revision: 2,
  status,
  validation: { passed: true, flaggedClaims: [], suggestions: [] },
  approved_revision: 2,
  approved_by: projectId,
  scheduled_time: null,
});
function setup(status: DraftRecord["status"] = "draft") {
  const query = vi.fn().mockResolvedValue({ rows: [{ tenant_id: projectId }] });
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT * FROM studio_drafts")) return { rows: [draft(status)] };
    if (sql.startsWith("SELECT provider,channels"))
      return { rows: [{ provider: "buffer", channels: [{ id: "channel", platform: "x" }] }] };
    return { rows: [] };
  });
  return {
    query,
    service: new ApprovalService(
      { query } as unknown as Pool,
      { enabled: true, tokenKey: "01".repeat(32), model: "test" },
      {} as never,
    ),
  };
}
beforeEach(() => vi.resetAllMocks());
describe("human content approval", () => {
  it("encrypts verified access tokens with the configured independent key", async () => {
    const { service } = setup();
    vi.spyOn(service.buffer, "channels").mockResolvedValue([]);
    mocks.query.mockResolvedValue({ rows: [{ id: projectId, provider: "buffer", channels: [] }] });
    const result = await service.connect(projectId, projectId, "buffer", {
      accessToken: "private-buffer-token",
    });
    const encrypted = mocks.query.mock.calls[0]![1][3];
    expect(encrypted).not.toContain("private-buffer-token");
    expect(TokenCrypto.decrypt(encrypted, Buffer.alloc(32, 1))).toEqual({
      accessToken: "private-buffer-token",
    });
    expect(result).not.toHaveProperty("encrypted_credentials");
  });
  it("rejects stale revisions and illegal state transitions", () => {
    expect(() => requireRevision(draft(), 1, ["draft"])).toThrow();
    expect(() => requireRevision(draft("scheduled"), 2, ["draft", "approved"])).toThrow();
    expect(() => requireRevision(draft("in_review"), 2, ["in_review"])).not.toThrow();
  });
  it("editing a reviewed or approved draft increments revision and clears approval and validation", async () => {
    const { service } = setup("approved");
    await service.edit(projectId, projectId, projectId, 2, studioDocument());
    const sql = mocks.query.mock.calls.find((call) =>
      call[0].startsWith("UPDATE studio_drafts"),
    )?.[0];
    expect(sql).toContain("revision=revision+1");
    expect(sql).toContain("validation=NULL");
    expect(sql).toContain("approved_by=NULL,approved_revision=NULL");
  });
  it("approval requires in-review status and a passed server-side report", async () => {
    const { service } = setup("draft");
    await expect(service.approve(projectId, projectId, projectId, 2)).rejects.toMatchObject({
      code: "STUDIO_CONFLICT",
    });
    mocks.query.mockResolvedValue({
      rows: [{ ...draft("in_review"), validation: { passed: false } }],
    });
    await expect(service.approve(projectId, projectId, projectId, 2)).rejects.toMatchObject({
      code: "VALIDATION_REQUIRED",
    });
  });
  it("never schedules an unapproved revision", async () => {
    const { service } = setup("in_review");
    await expect(
      service.schedule(projectId, projectId, projectId, {
        revision: 2,
        scheduledTime: new Date(Date.now() + 60000).toISOString(),
        targets: [{ platform: "x", channelId: "channel" }],
      }),
    ).rejects.toMatchObject({ code: "STUDIO_CONFLICT" });
    expect(
      mocks.query.mock.calls.some((call) =>
        call[0].startsWith("INSERT INTO publishing_deliveries"),
      ),
    ).toBe(false);
  });
  it("persists deliveries with the approved revision and updates scheduling in one transaction", async () => {
    const { service } = setup("approved");
    await service.schedule(projectId, projectId, projectId, {
      revision: 2,
      scheduledTime: new Date(Date.now() + 60000).toISOString(),
      targets: [{ platform: "x", channelId: "channel" }],
    });
    const insert = mocks.query.mock.calls.find((call) =>
      call[0].startsWith("INSERT INTO publishing_deliveries"),
    );
    expect(insert?.[1].slice(0, 6)).toEqual([projectId, projectId, projectId, 2, "x", "channel"]);
    expect(mocks.query.mock.calls[0]![0]).toContain("FOR UPDATE");
  });
  it("checks project ownership before exposing records", async () => {
    const { service, query } = setup();
    query.mockResolvedValue({ rows: [] });
    await expect(service.list(projectId, projectId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("requires actual carousel artwork and video assets for video-only channels", () => {
    expect(() => validateTargetMedia("instagram", [], studioDocument())).toThrow();
    expect(() => validateTargetMedia("tiktok", [], studioDocument())).toThrow();
    expect(() =>
      validateTargetMedia("youtube", [{ mime_type: "video/mp4" } as never], studioDocument()),
    ).not.toThrow();
  });
});
