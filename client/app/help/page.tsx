import Link from "next/link";
import { ArrowRight, BookOpen, CircleHelp, ShieldCheck } from "lucide-react";

export const metadata = { title: "Help & getting started | Savoir" };

const steps = [
  {
    title: "Set up your brand",
    text: "Add your website, brand aliases, competitors, and the countries and languages you want to monitor.",
    href: "/projects",
    action: "Manage projects",
  },
  {
    title: "Ask the right questions",
    text: "Add questions your audience asks, then collect answers with an available engine. Use schedules for ongoing monitoring.",
    href: "/prompts",
    action: "Open prompts",
  },
  {
    title: "Turn evidence into improvements",
    text: "Review mentions and citations, run a website audit, and use the Action Center to prioritize fixes.",
    href: "/actions",
    action: "Review actions",
  },
];
const questions = [
  [
    "Why is my dashboard empty?",
    "Analytics need completed monitoring answers. Add prompts, open Monitoring, and start a collection. Website findings need a completed Technical AEO Audit. Each source supplies different evidence.",
  ],
  [
    "Why is a run still queued?",
    "Collections are processed by a background worker and spaced to respect provider limits. Check Monitoring for worker health and provider errors. A configured engine can still have an invalid key or exhausted quota.",
  ],
  [
    "What should I do when a provider fails?",
    "Open the run’s error details. Review the connection and quota before collecting again. Authentication and quota failures are not fixed by repeatedly retrying the same request.",
  ],
  [
    "Where does AI traffic come from?",
    "Traffic statistics come from your connected Google Analytics property. Search Console supplies search queries and prompt opportunities. Monitoring answers and website crawls do not provide visit counts.",
  ],
  [
    "How do I recover access?",
    "Use Forgot password on the sign-in page. Request a reset for the email address you registered with, then follow the emailed link. Google-only accounts can sign in with Google.",
  ],
];

export default function HelpPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <nav
        className="mb-12 flex flex-wrap items-center justify-between gap-4"
        aria-label="Help navigation"
      >
        <Link href="/dashboard" className="brand">
          savoir.
        </Link>
        <Link href="/dashboard" className="button">
          Back to workspace <ArrowRight size={16} />
        </Link>
      </nav>
      <p className="eyebrow">Help & getting started</p>
      <h1 className="text-4xl font-semibold tracking-tight">
        From your first question to a clearer next step.
      </h1>
      <p className="max-w-2xl text-lg text-muted-foreground">
        Learn where your data comes from, set up your first collection, and find
        your way past common issues.
      </p>
      <section
        className="my-10 grid gap-5 md:grid-cols-3"
        aria-label="Getting started"
      >
        {steps.map((step, index) => (
          <article
            key={step.href}
            className="rounded-2xl border border-solid border-border bg-card p-6"
          >
            <p className="text-sm font-semibold text-primary">
              Step {index + 1}
            </p>
            <h2 className="text-xl">{step.title}</h2>
            <p className="text-muted-foreground">{step.text}</p>
            <Link className="text-link" href={step.href}>
              {step.action} <ArrowRight size={14} />
            </Link>
          </article>
        ))}
      </section>
      <section id="methodology" className="my-10 rounded-2xl bg-muted p-6">
        <ShieldCheck size={24} />
        <h2 className="mt-3 text-2xl">Understand the evidence</h2>
        <p>
          <strong>Observed:</strong> saved answers, source citations, crawl
          results, and imported analytics. These reflect a particular collection
          time and source.
        </p>
        <p>
          <strong>Modeled:</strong> visibility scores, readiness scores, and
          estimated opportunities summarize evidence using platform formulas.
        </p>
        <p>
          <strong>Simulated context:</strong> country and language settings
          guide model prompts; they do not prove a user was physically searching
          from that location. Some AI visits arrive without a referrer and
          cannot be attributed.
        </p>
        <Link href="/answers" className="text-link">
          <BookOpen size={16} /> Inspect collected answers
        </Link>
      </section>
      <section aria-labelledby="faq-title">
        <CircleHelp size={24} />
        <h2 id="faq-title" className="mt-3 text-2xl">
          Common questions
        </h2>
        {questions.map(([question, answer]) => (
          <details
            key={question}
            className="mb-3 rounded-xl border border-solid border-border bg-card p-5"
          >
            <summary className="cursor-pointer font-semibold">
              {question}
            </summary>
            <p className="mt-4 text-muted-foreground">{answer}</p>
          </details>
        ))}
      </section>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link className="button" href="/connections">
          Check connections
        </Link>
        <Link className="button" href="/monitoring">
          Open monitoring
        </Link>
        <Link className="button" href="/forgot-password">
          Reset password
        </Link>
      </div>
    </main>
  );
}
