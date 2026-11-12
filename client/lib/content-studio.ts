export type StudioStatus =
  "draft" | "in_review" | "approved" | "scheduled" | "published" | "failed";
export type StudioPlatform = "facebook" | "instagram" | "x" | "tiktok" | "youtube" | "wordpress";
export interface StudioDocument {
  brand_id: string;
  topic: string;
  question: string;
  intent: string;
  content: {
    facebook: { caption: string; cta: string };
    instagram: { caption: string; carousel_slides: string[] };
    x: { thread: string[] };
    short_video: {
      hook: string;
      script: string;
      scenes: { visual: string; voiceover: string; duration_seconds: number }[];
    };
    podcast: { title: string; script: string; show_notes: string };
    blog: {
      title: string;
      answer_first_intro: string;
      sections: { heading: string; body: string }[];
      meta_description: string;
    };
  };
}
export interface StudioDraft {
  id: string;
  document: StudioDocument;
  revision: number;
  status: StudioStatus;
  validation: {
    passed: boolean;
    flaggedClaims: { path: string; claim: string; reason: string; code: string }[];
    suggestions: string[];
  } | null;
  scheduled_time: string | null;
}
export interface StudioMedia {
  id: string;
  public_url: string;
  mime_type: string;
  size_bytes: number;
  ready: boolean;
}
export interface StudioChannel {
  id: string;
  name: string;
  platform: StudioPlatform;
  reminders?: boolean;
  hasDevice?: boolean;
  disconnected?: boolean;
}
export interface StudioSnapshot {
  drafts: StudioDraft[];
  connections: { id: string; provider: string; channels: StudioChannel[] }[];
  media: StudioMedia[];
  publishingEnabled: boolean;
  deliveries: {
    id: string;
    draft_id: string;
    platform: string;
    state: string;
    notice: string | null;
    remote_url: string | null;
  }[];
}
export function canEditDraft(status: StudioStatus) {
  return ["draft", "in_review", "approved"].includes(status);
}
export function canApproveDraft(draft: StudioDraft, dirty: boolean) {
  return !dirty && draft.status === "in_review" && draft.validation?.passed === true;
}
export function scheduleUtc(value: string, now = Date.now()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() < now + 30000)
    throw new Error("Choose a time at least 30 seconds in the future.");
  return date.toISOString();
}
export interface StudioField {
  path: Array<string | number>;
  label: string;
  value: string;
}
export function studioFields(
  document: StudioDocument,
  channel: keyof StudioDocument["content"],
): StudioField[] {
  const fields: StudioField[] = [];
  function walk(value: unknown, path: Array<string | number>) {
    if (typeof value === "string")
      fields.push({
        path,
        label: path
          .slice(2)
          .map((part) => (typeof part === "number" ? part + 1 : part.replaceAll("_", " ")))
          .join(" / "),
        value,
      });
    else if (Array.isArray(value)) value.forEach((entry, index) => walk(entry, [...path, index]));
    else if (value && typeof value === "object")
      Object.entries(value).forEach(([key, entry]) => walk(entry, [...path, key]));
  }
  walk(document.content[channel], ["content", channel]);
  return fields;
}
export function updateStudioField(
  document: StudioDocument,
  path: Array<string | number>,
  value: string,
): StudioDocument {
  const copy = structuredClone(document);
  let cursor = copy as unknown as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) cursor = cursor[key] as typeof cursor;
  cursor[path[path.length - 1]!] = value;
  return copy;
}
