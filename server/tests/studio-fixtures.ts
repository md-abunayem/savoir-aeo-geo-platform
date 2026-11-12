import type { StudioDocument } from "../src/services/content/content-studio.schema.js";
import type { MemoryFact } from "../src/services/memory/memory.service.js";

export const projectId = "11111111-1111-4111-8111-111111111111";
export const productId = "22222222-2222-4222-8222-222222222222";
export const brandId = "33333333-3333-4333-8333-333333333333";
export const product: MemoryFact = {
  id: productId,
  kind: "product",
  facts: {
    name: "Starter",
    features: ["Scheduled reports"],
    specs: { users: "5" },
    pricing: "USD 29/month",
    validFrom: null,
    validUntil: null,
  },
};
export const brand: MemoryFact = {
  id: brandId,
  kind: "brand",
  facts: {
    brandVoice: "Clear and practical",
    toneGuidelines: ["No hype"],
    audiencePersonas: ["Small teams"],
    negativeKeywords: ["guaranteed"],
    negativeClaims: ["best in the world"],
  },
};
export function studioDocument(): StudioDocument {
  return {
    brand_id: projectId,
    topic: "Reporting",
    question: "How can we improve reporting?",
    intent: "educational",
    content: {
      facebook: { caption: "Use a clear reporting routine.", cta: "Review your workflow." },
      instagram: {
        caption: "Build a reporting routine.",
        carousel_slides: ["Set a goal.", "Review the results."],
      },
      x: {
        thread: ["Set a reporting goal.", "Review results regularly.", "Discuss what to change."],
      },
      short_video: {
        hook: "Make reporting clearer.",
        script: "Start with a goal, then review results.",
        scenes: [
          {
            visual: "A team reviews a report.",
            voiceover: "Start with your goal.",
            duration_seconds: 5,
          },
        ],
      },
      podcast: {
        title: "Clearer reporting",
        script: "Today we discuss reporting habits.",
        show_notes: "Set goals and review results.",
      },
      blog: {
        title: "How to improve reporting",
        answer_first_intro: "Begin with a specific reporting goal.",
        sections: [
          { heading: "Set your goal", body: "Decide which question the report should answer." },
        ],
        meta_description: "Practical reporting habits for teams.",
      },
    },
  };
}
