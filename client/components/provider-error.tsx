"use client";

import { useState } from "react";
import { providerError, providerErrorSummary, providerHelpLinks } from "../lib/provider-status";

export function ProviderError({
  code,
  engine,
  compact = false,
}: {
  code: string | null;
  engine: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  if (!code) return null;
  const links = providerHelpLinks(engine);
  return (
    <div className={"provider-error" + (compact ? " provider-error-compact" : "")}>
      <p>{compact ? providerErrorSummary(code) : providerError(code, engine)}</p>
      <details>
        <summary>{compact ? "Error details" : "Technical details"}</summary>
        {compact && <p>{providerError(code, engine)}</p>}
        <div className="provider-error-details">
          <code>{code}</code>
          <button
            type="button"
            className="text-button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(code);
                setCopied(true);
                setCopyError(false);
                window.setTimeout(() => setCopied(false), 1800);
              } catch {
                setCopyError(true);
              }
            }}
          >
            {copied ? "Copied" : "Copy code"}
          </button>
          {copyError && <span role="status">Copy is unavailable in this browser.</span>}
        </div>
        {links.length > 0 && (
          <ul>
            {links.map((link) => (
              <li key={link.href}>
                <a href={link.href} target="_blank" rel="noreferrer">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
