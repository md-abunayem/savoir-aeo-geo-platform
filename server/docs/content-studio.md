# AI multi-format content studio (Phase 3)

This phase adds service-level generation and validation. It does not publish,
persist or serve content through new HTTP endpoints. No additional database
migration is needed; Phase 1 memory tables and pgvector must already be available.

## Generate from one brief

Use an authenticated tenant context and the restricted database pool:

```ts
import { createContentStudioService } from "../src/services/content/content-studio.service.js";

const studio = createContentStudioService(
  pool,
  { userId, tenantId },
  { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL },
);

const result = await studio.generate(projectId, {
  topic: brief.title,
  question: brief.targetPrompts[0],
  intent: "educational",
  brief: brief.markdownContent,
});

// Send failed validation results for revision; do not treat them as approved assets.
if (!result.validation.passed) {
  console.log(result.validation.flaggedClaims);
}
```

Input `intent` accepts `educational`, `awareness`, `consideration`, `decision`, or
`retention`. Topic is limited to 500 characters, question to 4000, and the brief
to 20000. Optional `threshold` is minimum cosine similarity, default 0.7.

The result has three fields:

- `document`: the blueprint JSON, with `brand_id` equal to the project UUID,
  topic, question, intent, and all six channel objects.
- `validation`: `{ passed, flaggedClaims, suggestions }`.
- `evidence`: product fact IDs and brand rule IDs used during generation.

The document uses the requested fields:

| Channel     | Fields                                                |
| ----------- | ----------------------------------------------------- |
| facebook    | caption, cta                                          |
| instagram   | caption, carousel_slides (strings)                    |
| x           | thread (strings)                                      |
| short_video | hook, script, scenes                                  |
| podcast     | title, script, show_notes                             |
| blog        | title, answer_first_intro, sections, meta_description |

Each video scene contains `visual`, `voiceover`, and positive `duration_seconds`.
Each blog section contains `heading` and `body`. Arrays contain at least one item.
Schema validation rejects missing/unknown fields and changed project/topic/question/
intent metadata. Structural array bounds of 30 allow a platform violation such as
11 carousel slides to be returned as a validation issue rather than discarded.

## Grounding

The system prompt includes approved, currently valid Product Facts returned by
Phase 1 cosine retrieval, plus **all** approved Brand Rules. Brand exclusions
cannot be lost because they fall below a semantic similarity threshold.

The generation prompt enforces:

> Only mention features and pricing explicitly confirmed in the provided Product Facts. If unconfirmed, omit or flag.

Briefs are editorial context, not factual authority. Features, pricing, numerical
results and comparisons must be grounded in memory, even if they appear in the
brief. Product prices, billing periods and conditions must stay attached to the
correct product. The service permits educational content when no product facts
match, but the same independent validation still runs.

Generation context is capped at 100000 UTF-8 bytes; oversize context is rejected
without silently truncating mandatory rules. Memory access uses tenant-owner
checks and RLS before private facts reach the provider.

## Independent fact checking

`FactCheckerService.check(document, { productFactIds? })` can also review a draft
independently. Construct it with a trusted `MemoryService` and the model config.
It re-reads approved memory and excludes expired, future or unapproved products.
Studio generation passes its retrieved product IDs to restrict the review to the
facts actually available during generation. A referenced record that has become
unavailable causes validation to fail. A standalone check without IDs considers
all currently approved product facts in the project.

Deterministic checks run locally:

- Each X post: at most 280 weighted characters, using the official `twitter-text`
  parser for URL shortening, Unicode normalization, CJK and emoji counting.
  See [X's character-counting documentation](https://docs.x.com/fundamentals/counting-characters).
- Instagram carousel: at most 10 slides, per the blueprint.
- Video hook: at most 15 whitespace-separated words. This is a text proxy;
  actual spoken duration under three seconds must be measured with narration.
- Literal negative brand keywords and claims: normalized, case-insensitive phrase
  matches with word boundaries. Semantic paraphrases are reviewed by the model.

A separate Gemini call inspects every publishable text field, including scene
descriptions/voiceovers and blog sections. It checks product claims, pricing,
specifications, conditions, comparative/quantitative claims and semantic brand
violations. Supported claims must cite actual product-memory IDs. Missing field
assessments, invalid evidence IDs, fabricated quote excerpts, invalid output or
provider failures produce `passed: false` with `VERIFICATION_UNAVAILABLE`.

Each flag includes `path`, `claim`, `code`, `reason`, and `evidenceIds`; suggestions
provide revision guidance. Local constraint violations are preserved even when
semantic verification fails. Review context is capped at 200000 UTF-8 bytes and
is not silently truncated. Database authorization or availability failures propagate
as errors, rather than being treated as empty evidence.

The checker is an automated review, not proof of truth. Semantic review can miss
claims or misjudge entailment. A passed report means the configured checks found
no issues, not that publication is risk-free. Nothing is automatically published
or marked approved. Rerun validation after edits or changes to product memory.

Provider configuration uses `GEMINI_API_KEY` and `GEMINI_MODEL`, independent of
monitoring. Missing configuration returns `STUDIO_NOT_CONFIGURED` for generation;
a standalone checker returns a failed report. Generation/provider/schema failures
return `STUDIO_GENERATION_FAILED` without exposing raw provider messages.
