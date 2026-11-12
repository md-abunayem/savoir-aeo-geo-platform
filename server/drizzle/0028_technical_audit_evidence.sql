ALTER TABLE public.technical_audits
  ADD COLUMN attempted_urls integer,
  ADD COLUMN fetched_pages integer,
  ADD COLUMN failed_requests integer,
  ADD COLUMN http_error_pages integer,
  ADD COLUMN excluded_pages integer,
  ADD COLUMN pages_scored integer,
  ADD COLUMN queued_urls_remaining integer,
  ADD COLUMN scoring_version integer NOT NULL DEFAULT 1,
  ADD COLUMN completion_reason text,
  ADD COLUMN site_wide_checks jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE public.technical_audits
  ALTER COLUMN scoring_version SET DEFAULT 2,
  ALTER COLUMN category_scores SET DEFAULT
    '{"botAccess":null,"indexability":null,"schema":null,"answerStructure":null,"performanceTrust":null,"agentReadability":null}'::jsonb;
--> statement-breakpoint
ALTER TABLE public.technical_audit_pages
  ADD COLUMN final_url text,
  ADD COLUMN fetch_error text,
  ADD COLUMN crawl_status varchar(20) NOT NULL DEFAULT 'legacy',
  ADD COLUMN excluded boolean NOT NULL DEFAULT false,
  ADD COLUMN exclusion_reason text;
--> statement-breakpoint
ALTER TABLE public.technical_audit_pages
  ALTER COLUMN crawl_status SET DEFAULT 'fetched',
  ALTER COLUMN page_score DROP NOT NULL,
  ALTER COLUMN page_score DROP DEFAULT;
