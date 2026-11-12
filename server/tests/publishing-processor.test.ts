import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { ApprovalService } from "../src/services/publishing/approval.service.js";
import { PublishingProcessor } from "../src/services/publishing/publishing.processor.js";
import { PublishingError } from "../src/services/publishing/publishing.validation.js";
import { TokenCrypto } from "../src/services/integrations/token-crypto.js";
import { projectId, studioDocument } from "./studio-fixtures.js";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/db/tenant.js", () => ({
  withTenantClient: async (
    _pool: unknown,
    _context: unknown,
    operation: (client: unknown) => unknown,
  ) => operation({ query: mocks.query }),
}));
const context = { userId: projectId, tenantId: projectId };
function setup(initialState = "queued", remoteId: string | null = null) {
  const createPost = vi.fn().mockResolvedValue({
    id: "remote",
    status: "sent",
    externalLink: "https://social.example/post",
  });
  const outcome = vi.fn().mockResolvedValue({ id: "remote", status: "scheduled" });
  const channels = vi.fn().mockResolvedValue([{ id: "channel", platform: "x" }]);
  const credentials = TokenCrypto.encrypt({ accessToken: "private-token" }, Buffer.alloc(32, 1));
  let savedState = initialState;
  mocks.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith("SELECT d.*"))
      return {
        rows: [
          {
            id: "delivery",
            draft_id: "draft",
            project_id: projectId,
            revision: 1,
            platform: "x",
            channel_id: "channel",
            state: initialState,
            remote_id: remoteId,
            media_ids: [],
            scheduling_type: "automatic",
            attempts: 0,
            document: studioDocument(),
          },
        ],
      };
    if (sql.startsWith("SELECT encrypted_credentials"))
      return { rows: [{ encrypted_credentials: credentials }] };
    if (sql.startsWith("UPDATE publishing_deliveries SET state=$2")) savedState = String(params[1]);
    if (sql.startsWith("SELECT state FROM")) return { rows: [{ state: savedState }] };
    return { rows: [] };
  });
  const service = new ApprovalService(
    {} as Pool,
    { enabled: true, tokenKey: "01".repeat(32), model: "test" },
    { complete: vi.fn() } as never,
    { buffer: { createPost, outcome, channels } as never },
  );
  const verify = vi
    .spyOn(service, "verify")
    .mockResolvedValue({ passed: true, flaggedClaims: [], suggestions: [] });
  return { processor: new PublishingProcessor(service), createPost, outcome, verify };
}
beforeEach(() => vi.resetAllMocks());
const persistedState = () =>
  mocks.query.mock.calls.find((call) =>
    call[0].startsWith("UPDATE publishing_deliveries SET state=$2"),
  )?.[1];

describe("publishing eligibility and outcome handling", () => {
  it("does not mutate the provider after losing its dispatch claim", async () => {
    const { processor, createPost } = setup();
    const query = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (sql: string, params: unknown[] = []) =>
      sql.startsWith("UPDATE publishing_deliveries SET locked_at=now()")
        ? { rows: [], rowCount: 0 }
        : query(sql, params),
    );
    await processor.process("delivery", context);
    expect(createPost).not.toHaveBeenCalled();
  });
  it("checks current facts before dispatch and marks published only on confirmed sent", async () => {
    const { processor, verify, createPost } = setup();
    await processor.process("delivery", context);
    expect(verify).toHaveBeenCalledWith(context, expect.objectContaining({ brand_id: projectId }));
    expect(createPost).toHaveBeenCalledTimes(1);
    expect(persistedState()?.[1]).toBe("published");
    expect(mocks.query.mock.calls[0]![0]).toContain("a.approved_revision=a.revision");
    expect(mocks.query.mock.calls[0]![0]).toContain("a.scheduled_time<=now()");
  });
  it("stops publication when facts no longer pass", async () => {
    const { processor, verify, createPost } = setup();
    verify.mockResolvedValue({ passed: false, flaggedClaims: [], suggestions: [] });
    await processor.process("delivery", context);
    expect(createPost).not.toHaveBeenCalled();
    expect(persistedState()?.[1]).toBe("failed");
    expect(persistedState()?.[4]).toBe("FACT_CHECK_FAILED_AT_DISPATCH");
  });
  it("polls an accepted post without creating another or rerunning generation", async () => {
    const { processor, outcome, createPost, verify } = setup("accepted", "remote");
    await processor.process("delivery", context);
    expect(outcome).toHaveBeenCalledWith("private-token", "remote");
    expect(createPost).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(persistedState()?.[1]).toBe("accepted");
  });
  it("records reminders as a manual action notification, not as publication", async () => {
    const { processor, createPost } = setup();
    createPost.mockResolvedValue({
      id: "remote",
      status: "scheduled",
      schedulingType: "notification",
      notificationStatus: "notified",
    } as never);
    await processor.process("delivery", context);
    expect(persistedState()?.[1]).toBe("manual_action");
    expect(persistedState()?.[4]).toContain("Open the Buffer mobile app");
  });
  it("honors Retry-After without multiplying mutation attempts", async () => {
    const { processor, createPost } = setup();
    createPost.mockRejectedValue(new PublishingError("BUFFER_RATE_LIMITED", 90));
    await processor.process("delivery", context);
    expect(persistedState()?.[1]).toBe("queued");
    expect(persistedState()?.[5]).toBeGreaterThanOrEqual(90);
    expect(createPost).toHaveBeenCalledTimes(1);
  });
  it("never blindly retries an ambiguous create", async () => {
    const { processor, createPost } = setup();
    createPost.mockRejectedValue(new PublishingError("BUFFER_NETWORK_ERROR", undefined, true));
    await processor.process("delivery", context);
    expect(persistedState()?.[1]).toBe("uncertain");
    expect(persistedState()?.[4]).toContain("Reconcile");
  });
  it("does not dispatch a duplicate, early, stale or unapproved claim", async () => {
    const { processor, createPost } = setup();
    mocks.query.mockResolvedValue({ rows: [] });
    await processor.process("delivery", context);
    expect(createPost).not.toHaveBeenCalled();
  });
});
