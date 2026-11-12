import { z } from "zod";

const text = z.string().trim().min(1).max(20000);
// Platform limits are checked separately so violations can be returned in a report.
export const studioDocumentSchema = z
  .object({
    brand_id: z.uuid(),
    topic: z.string().trim().min(1).max(500),
    question: z.string().trim().min(3).max(4000),
    intent: z.enum(["educational", "awareness", "consideration", "decision", "retention"]),
    content: z
      .object({
        facebook: z.object({ caption: text, cta: text }).strict(),
        instagram: z
          .object({ caption: text, carousel_slides: z.array(text).min(1).max(30) })
          .strict(),
        x: z.object({ thread: z.array(text).min(1).max(30) }).strict(),
        short_video: z
          .object({
            hook: text,
            script: text,
            scenes: z
              .array(
                z
                  .object({
                    visual: text,
                    voiceover: text,
                    duration_seconds: z.number().positive().max(600),
                  })
                  .strict(),
              )
              .min(1)
              .max(30),
          })
          .strict(),
        podcast: z.object({ title: text, script: text, show_notes: text }).strict(),
        blog: z
          .object({
            title: text,
            answer_first_intro: text,
            sections: z
              .array(z.object({ heading: text, body: text }).strict())
              .min(1)
              .max(30),
            meta_description: text,
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
export type StudioDocument = z.output<typeof studioDocumentSchema>;
export const studioInputSchema = studioDocumentSchema
  .pick({ topic: true, question: true, intent: true })
  .extend({
    brief: z.string().trim().min(1).max(20000),
    threshold: z.number().min(-1).max(1).default(0.7),
    winningPatterns: z.array(z.string().trim().min(1).max(1000)).max(20).optional(),
  })
  .strict();
export type StudioInput = z.input<typeof studioInputSchema>;

export interface ContentLeaf {
  path: string;
  text: string;
}
/** Only publishable content is reviewed, not the customer's topic/question metadata. */
export function contentLeaves(document: StudioDocument): ContentLeaf[] {
  const leaves: ContentLeaf[] = [];
  function walk(value: unknown, path: string) {
    if (typeof value === "string") leaves.push({ path, text: value });
    else if (Array.isArray(value))
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
    else if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) walk(entry, `${path}.${key}`);
    }
  }
  walk(document.content, "content");
  return leaves;
}

export function modelJsonSchema(schema: z.ZodType) {
  const jsonSchema = z.toJSONSchema(schema);
  delete jsonSchema.$schema;
  return jsonSchema;
}
