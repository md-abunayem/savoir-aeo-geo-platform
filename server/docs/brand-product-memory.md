# Brand and product memory (Phase 1)

Apply migration `0041_brand_product_memory` with `npm run db:migrate` from `server`.
The PostgreSQL server must have pgvector installed and the migration connection
must be allowed to create the `vector` extension. Local Compose uses
`pgvector/pgvector:pg16` for this purpose.

Instantiate `MemoryService(pool, authenticatedTenantContext, env.GEMINI_API_KEY)`
with the restricted runtime pool and a context obtained from authentication.
The existing tenant helper checks owner membership; row-level security also
checks project ownership on reads and writes.

- `saveBrandMemory(projectId, input, id?)` creates a brand rule document, or
  replaces the document identified by `id`.
- `saveProductMemory(projectId, input, id?)` creates or replaces product facts.
  `pricing` is a factual description including currency and billing period;
  `specs` maps specification names to values. Validity boundaries are optional
  JavaScript `Date` values; the start is inclusive and the end exclusive.
- Both save methods return `{ id }`, default to `draft`, and regenerate embeddings
  before persisting the facts and embedding together. Updates replace the full
  document; omitted optional fields reset to defaults.
- `searchRelevantFacts(projectId, queryText, threshold = 0.7)` returns up to 20
  approved brand/product documents, ranked by cosine similarity. The threshold
  is minimum similarity in `[-1, 1]`, not maximum distance. Products outside their
  validity window are excluded. Results include `id`, `kind`, `facts`, and
  `similarity`.

Document and query vectors use `text-embedding-004` with 768 dimensions and the
`RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY` task types respectively. Provider errors
and malformed embeddings fail the operation without changing persisted facts.
Changing the embedding model requires re-embedding all records before retrieval.

This phase provides storage and retrieval only. Content generation and HTTP
endpoints are not yet connected to memory. Consumers must treat retrieved
negative keywords and claims as prohibitions, and must not treat missing search
results as permission to invent facts. Mandatory brand rules should also be
loaded explicitly when generation is integrated: semantic retrieval alone does
not guarantee every rule will match a query.
