"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, Bell, Moon, Search, Sun, X } from "lucide-react";

function subscribeTheme(callback: () => void) {
  window.addEventListener("savoir-theme", callback);
  return () => window.removeEventListener("savoir-theme", callback);
}

export function WorkspaceTools({
  sections,
  projectId,
}: {
  sections: Record<string, string>;
  projectId?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const dark = useSyncExternalStore(
    subscribeTheme,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
  function openSearch() {
    setQuery("");
    dialog.current?.showModal();
    input.current?.focus();
  }
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (dialog.current?.open) dialog.current.close();
        else openSearch();
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  function toggleTheme() {
    document.documentElement.classList.toggle("dark", !dark);
    try {
      localStorage.setItem("savoir-theme", dark ? "light" : "dark");
    } catch {
      /* Theme still works when storage is unavailable. */
    }
    window.dispatchEvent(new Event("savoir-theme"));
  }
  const results = Object.entries(sections).filter(([key, label]) =>
    `${key} ${label}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const projectHref = (href: string) =>
    projectId
      ? `${href}${href.includes("?") ? "&" : "?"}project=${encodeURIComponent(projectId)}`
      : href;
  return (
    <>
      <button
        ref={trigger}
        className="top-search"
        onClick={openSearch}
        aria-label="Search workspace"
      >
        <Search size={16} />
        <span>Search anything</span>
        <kbd>Ctrl K</kbd>
      </button>
      <button
        className="icon-button theme-toggle"
        onClick={toggleTheme}
        aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
        title={dark ? "Light mode" : "Dark mode"}
      >
        {dark ? <Sun size={17} /> : <Moon size={17} />}
      </button>
      <Link
        className="icon-button"
        href={projectHref("/reporting")}
        aria-label="Reports and alerts"
        title="Reports and alerts"
      >
        <Bell size={17} />
      </Link>
      <dialog
        ref={dialog}
        className="workspace-search-dialog"
        aria-labelledby="workspace-search-title"
        onClose={() => trigger.current?.focus()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            dialog.current?.close();
          }
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <div className="workspace-search-body">
          <div className="workspace-search-heading">
            <h2 id="workspace-search-title">Find your next view</h2>
            <button
              className="icon-button"
              aria-label="Close search"
              onClick={() => dialog.current?.close()}
            >
              <X size={18} />
            </button>
          </div>
          <label>
            Search the workspace
            <input
              ref={input}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Prompts, citations, billing…"
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  dialog.current
                    ?.querySelector<HTMLAnchorElement>(
                      ".workspace-search-result",
                    )
                    ?.focus();
                }
              }}
            />
          </label>
          <p className="workspace-search-count" role="status">
            {results.length} {results.length === 1 ? "section" : "sections"}{" "}
            found
          </p>
          <nav className="workspace-search-results" aria-label="Search results">
            {results.map(([key, label]) => (
              <Link
                key={key}
                className="workspace-search-result"
                href={projectHref(
                  key === "overview" ? "/dashboard" : `/${key}`,
                )}
                onClick={() => dialog.current?.close()}
              >
                {label}
                <ArrowRight size={15} />
              </Link>
            ))}
            {!results.length && (
              <p className="muted">
                No matching sections. Try “prompts” or “billing”.
              </p>
            )}
          </nav>
          <p className="workspace-search-help">
            Search workspace sections · Tab to browse · Esc to close
          </p>
        </div>
      </dialog>
    </>
  );
}
