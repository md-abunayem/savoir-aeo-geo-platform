import Link from "next/link";
export default function NotFound() {
  return (
    <main className="standalone">
      <p className="eyebrow">404</p>
      <h1>This page is not available.</h1>
      <Link className="button primary" href="/dashboard">
        Back to your workspace
      </Link>
    </main>
  );
}
