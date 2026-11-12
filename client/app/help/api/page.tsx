import Link from "next/link";

export const metadata = { title: "Public API guide | Savoir" };

export default function ApiGuide() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <nav className="mb-10 flex flex-wrap gap-4">
        <Link className="button" href="/help">
          Help center
        </Link>
        <Link className="button" href="/traffic">
          Manage integrations
        </Link>
      </nav>
      <p className="eyebrow">Developer guide</p>
      <h1 className="text-4xl font-semibold">Connect your reporting tools.</h1>
      <p className="text-lg text-muted-foreground">
        Use a project-scoped API key to read your traffic and optimization
        actions from a server or automation.
      </p>
      <section className="my-8 rounded-2xl border border-solid border-border bg-card p-6">
        <h2>Create a key</h2>
        <ol className="space-y-3 pl-5">
          <li>
            Open AI Traffic, then the Integrations tab for the project you want
            to access.
          </li>
          <li>
            Create a key with <code>read:traffic</code>,{" "}
            <code>read:actions</code>, or both. Copy the secret when it is
            shown.
          </li>
          <li>
            Send it in the <code>Authorization: Bearer</code> header. Keep the
            key in your server’s secret storage.
          </li>
        </ol>
      </section>
      <section className="my-8">
        <h2>Available endpoints</h2>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Request</th>
                <th>Required scope</th>
                <th>Parameters</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>GET /v1/public/projects/PROJECT_ID/traffic</code>
                </td>
                <td>
                  <code>read:traffic</code>
                </td>
                <td>
                  <code>days</code>: 1–365, default 30
                </td>
              </tr>
              <tr>
                <td>
                  <code>GET /v1/public/projects/PROJECT_ID/actions</code>
                </td>
                <td>
                  <code>read:actions</code>
                </td>
                <td>
                  <code>limit</code>: 1–100; <code>offset</code>; optional{" "}
                  <code>status</code>, <code>category</code>, and{" "}
                  <code>search</code>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section className="my-8">
        <h2>Example request</h2>
        <p>
          Replace the host, project ID, and key with your values. The project ID
          appears in the workspace URL as <code>?project=…</code>.
        </p>
        <pre className="overflow-x-auto rounded-xl bg-muted p-5">
          <code>{`curl 'https://YOUR_SAVOIR_HOST/v1/public/projects/PROJECT_ID/traffic?days=30' \\\n  -H 'Authorization: Bearer YOUR_API_KEY'`}</code>
        </pre>
        <p>
          Successful responses use{" "}
          <code>{'{ "success": true, "data": { ... } }'}</code>. These endpoints
          are read-only and do not start monitoring or sync jobs.
        </p>
      </section>
      <section className="my-8 rounded-2xl bg-muted p-6">
        <h2>Errors and access</h2>
        <ul className="space-y-3 pl-5">
          <li>
            <strong>401:</strong> missing, expired, revoked, incorrectly scoped,
            or wrong-project key.
          </li>
          <li>
            <strong>400:</strong> invalid project ID or query parameters.
          </li>
          <li>
            <strong>429:</strong> rate limit reached or rate limiting is
            unavailable. Wait one minute before retrying.
          </li>
        </ul>
        <p>
          Each key has its configured requests-per-minute limit. There is also a
          shared limit of 180 requests per minute per source IP. Revoking a key
          prevents new authenticated requests; requests already authorized may
          finish.
        </p>
      </section>
    </main>
  );
}
