import { describe, expect, it } from "vitest";
import {
  canApproveDraft,
  canEditDraft,
  scheduleUtc,
  updateStudioField,
  type StudioDocument,
  type StudioDraft,
} from "../lib/content-studio";
describe("content studio review guards", () => {
  it("only permits approval of the exact saved, validated revision in review", () => {
    const draft = { status: "in_review", validation: { passed: true } } as StudioDraft;
    expect(canApproveDraft(draft, false)).toBe(true);
    expect(canApproveDraft(draft, true)).toBe(false);
    expect(canApproveDraft({ ...draft, status: "draft" }, false)).toBe(false);
    expect(canApproveDraft({ ...draft, validation: null }, false)).toBe(false);
    expect(canEditDraft("scheduled")).toBe(false);
    expect(canEditDraft("published")).toBe(false);
  });
  it("converts schedule offsets to UTC and rejects past times", () => {
    expect(scheduleUtc("2026-12-01T10:00:00+06:00", Date.parse("2026-11-11T00:00:00Z"))).toBe(
      "2026-12-01T04:00:00.000Z",
    );
    expect(() => scheduleUtc("invalid")).toThrow();
    expect(() => scheduleUtc("2020-01-01T00:00:00Z")).toThrow();
  });
  it("updates the selected nested channel without mutating the saved revision", () => {
    const document = { content: { x: { thread: ["Saved post"] } } } as StudioDocument;
    const edited = updateStudioField(document, ["content", "x", "thread", 0], "Edited post");
    expect(edited.content.x.thread[0]).toBe("Edited post");
    expect(document.content.x.thread[0]).toBe("Saved post");
  });
});
