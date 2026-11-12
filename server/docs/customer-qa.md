# Customer Q&A discovery and intent classification

Apply `0042_customer_questions` using `npm run db:migrate` from `server`.
The API uses the existing restricted runtime connection, authenticated owner
membership, project context lookup, and forced row-level security.

New questions are classified using `GEMINI_API_KEY` and `GEMINI_MODEL`, independently
of monitoring being enabled. Without a Gemini key, backlog reads still work and
new imports return `503 QA_NOT_CONFIGURED`. Classification errors return
`502 QA_CLASSIFICATION_FAILED`; no portion of the batch is written.

## Import

`POST /v1/projects/:projectId/qa/ingest` requires the access session cookie and
a signed CSRF token from `GET /v1/auth/csrf` in both the `savoir_csrf` cookie and
`X-CSRF-Token` header. Maximum body size: 1 MB. Maximum batch: 100 questions.
Ingestion is limited to 10 requests per authenticated user per minute.

Send `application/json` with a question array or this envelope:

```json
{
  "questions": [
    {
      "source": "faq",
      "questionText": "How does your platform compare with manual reporting?",
      "demandScore": 80,
      "businessPriority": 90
    }
  ]
}
```

Allowed sources: `faq`, `support_ticket`, `reddit`, `survey`. Questions must contain
3–4000 characters. Scores are integers from 0 to 100. Supplied demand scores are
used as-is; otherwise demand defaults to the number of occurrences in the import
batch, capped at 100. Business priority defaults to 50. These values are importer
signals, not estimated search volumes.

For CSV, send `text/csv` (or `application/csv`), or JSON `{ "csv": "..." }`:

```csv
source,question_text,demand_score,business_priority
faq,What is answer engine optimization?,70,80
support_ticket,How do I reconnect my account?,60,90
```

`source` and `question_text` headers are required; score columns are optional.
Quoted commas, escaped quotes, CRLF, BOM, and multiline fields are supported.
Unknown or duplicate columns, malformed CSV and invalid rows reject the entire import.

Ticket exports use JSON with a `tickets` array:

```json
{
  "tickets": [
    {
      "subject": "How do I reconnect my account?",
      "description": "My existing connection has expired.",
      "businessPriority": 90
    }
  ]
}
```

The subject and optional description become a single `support_ticket` question.
The importer accepts exported questions/tickets; it does not connect to ticket
providers, crawl Reddit or extract multiple questions from ticket conversations.

Duplicate identity is project + source + SHA-256 of normalized question text
(NFKC, lowercase, collapsed whitespace). Within a batch, duplicates use the highest
supplied scores. Re-importing an existing identity skips it without reclassification
or changing its scores/status. Concurrent imports are protected by a unique index.

Response `data` contains `received`, `imported`, `duplicates`, and newly inserted
`questions`. New entries have status `backlog`.

## Opportunities

`GET /v1/projects/:projectId/qa/opportunities` returns `data.questions` and
`data.nextOffset` (`null` when there are no more results). It requires an authenticated
owner and is limited to 120 requests per user per minute.

Optional filters: `intent`, `source`, `status` (default `backlog`), `limit` (1–100,
default 50), `offset` (0–100000, default 0). Statuses are `backlog`, `planned`,
`published`, `dismissed`; this phase does not add status mutation endpoints.

Questions are ordered by `priorityScore = 0.6 * demandScore + 0.4 * businessPriority`
descending, demand descending, then creation time and ID ascending. Each record
includes its intent, scores, status and the server-controlled content recommendations:

| Intent        | Recommended formats                      |
| ------------- | ---------------------------------------- |
| awareness     | Educational Blog, Explainer Video Script |
| consideration | Comparison Post, Carousel Slides         |
| decision      | Case Study, Demo Script                  |
| retention     | Tutorial, Quick Video, FAQ               |

The few-shot classifier distinguishes purchase intent from existing customer usage,
uses structured JSON output, and rejects unknown intents, missing results, or
incorrect result indices. Imported text is treated as data in the classification
prompt. No raw question data or provider responses are included in classifier errors.
