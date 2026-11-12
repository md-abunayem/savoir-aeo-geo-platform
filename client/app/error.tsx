"use client";

import Link from "next/link";

export default function ErrorPage({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <main className="standalone" role="alert">
      <p className="eyebrow">Something went wrong</p>
      <h1>We couldn’t open this page.</h1>
      <p>
        Try loading it again. If the problem continues, return to your projects.
      </p>
      <div className="actions">
        <button className="button primary" onClick={retry}>
          Try again
        </button>
        <Link className="button" href="/projects">
          Your projects
        </Link>
        <Link className="button" href="/help">
          Get help
        </Link>
      </div>
    </main>
  );
}
