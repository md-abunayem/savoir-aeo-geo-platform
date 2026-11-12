ALTER TABLE public.technical_audit_pages
  ADD COLUMN crawl_source varchar(20),
  ADD COLUMN fallback_reason text,
  ADD COLUMN duplicate_of text;
--> statement-breakpoint
ALTER TABLE public.technical_audits ALTER COLUMN scoring_version SET DEFAULT 3;
