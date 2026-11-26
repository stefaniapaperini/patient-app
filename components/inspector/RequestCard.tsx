"use client";

import { useState } from "react";
import Link from "next/link";
import { explainRequest, splitUrl, toCurl } from "@/lib/inspector/explain";
import { SEARCH_SPEC, specUrl } from "@/lib/inspector/glossary";
import type { LogEntry } from "@/lib/inspector/store";
import { JsonTree } from "./JsonTree";

export function statusClass(status?: number): string {
  if (status === undefined) return "badge";
  if (status === 0) return "badge badge-danger";
  if (status < 300) return "badge badge-active";
  if (status < 500) return "badge badge-warn";
  return "badge badge-danger";
}

export function statusText(e: Pick<LogEntry, "status" | "error">): string {
  if (e.status === undefined) return "pending";
  if (e.status === 0) return e.error?.startsWith("Cancelled") ? "cancelled" : "network error";
  return String(e.status);
}

/** "/api/fhir/Patient?x" -> "[base]/Patient?x", the notation the FHIR specification uses. */
export function displayUrl(url: string): string {
  const { path, query } = splitUrl(url);
  let q = query;
  try {
    q = decodeURIComponent(query.replace(/\+/g, " "));
  } catch {
    // keep it encoded
  }
  return `[base]${path ? "/" + path : ""}${q ? "?" + q : ""}`;
}

function summarizeBody(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as { resourceType?: string; total?: number; entry?: unknown[]; id?: string };
  if (b.resourceType === "Bundle") {
    const n = b.entry?.length ?? 0;
    return `Bundle with ${n} entr${n === 1 ? "y" : "ies"}${b.total !== undefined ? ` · total ${b.total}` : ""}`;
  }
  if (b.resourceType) return `${b.resourceType}${b.id ? "/" + b.id : ""}`;
  return undefined;
}

export function consoleHref(e: Pick<LogEntry, "method" | "url" | "requestBody">): string {
  // Keep the query encoded: decoding could turn a value's "&" or "#" into URL syntax.
  const { path, query } = splitUrl(e.url);
  const p = new URLSearchParams({ method: e.method, url: path + (query ? "?" + query : "") });
  if (e.requestBody !== undefined) p.set("body", JSON.stringify(e.requestBody, null, 2));
  return `/console?${p}`;
}

/**
 * One request (with its later pages, for multi-page searches): what was asked, what each query
 * parameter means, what came back, and how to repeat it in the console or with curl.
 */
export function RequestCard({
  entries,
  defaultOpen = false,
  showConsoleLink = true,
}: {
  entries: LogEntry[];
  defaultOpen?: boolean;
  showConsoleLink?: boolean;
}) {
  const [showBody, setShowBody] = useState(defaultOpen);
  const [page, setPage] = useState(0);
  const [copied, setCopied] = useState(false);
  const first = entries[0];
  if (!first) return null;
  const current = entries[Math.min(page, entries.length - 1)];
  const ex = explainRequest(first.method, first.url);
  const totalMs = entries.reduce((s, e) => s + (e.durationMs ?? 0), 0);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toCurl(current.method, current.url, current.requestBody));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: the command is visible below anyway
    }
  };

  return (
    <div className="req">
      <div className="req-line">
        <span className="req-method">{first.method}</span>
        <code className="req-url">{displayUrl(first.url)}</code>
      </div>
      <div className="req-meta">
        <span className={statusClass(current.status)}>{statusText(current)}</span>
        {first.durationMs !== undefined && <span>{totalMs} ms</span>}
        {entries.length > 1 && <span>{entries.length} pages</span>}
        {summarizeBody(current.responseBody) && <span>{summarizeBody(current.responseBody)}</span>}
      </div>
      <p className="req-what">
        <b>{ex.interaction}</b>
        {ex.resourceType && (
          <>
            {" "}
            on{" "}
            <a href={specUrl(ex.resourceType)} target="_blank" rel="noreferrer" title="FHIR R4 specification">
              {ex.resourceType}
            </a>
          </>
        )}
        {ex.id && (
          <>
            {" "}
            with id <code>{ex.id}</code>
          </>
        )}
        .
      </p>
      {ex.params.length > 0 && (
        <dl className="req-params">
          {ex.params.map((p, i) => (
            <div key={i}>
              <dt>
                <code>
                  {p.name}={p.value.length > 60 ? p.value.slice(0, 60) + "…" : p.value}
                </code>
              </dt>
              <dd>
                {p.text}
                {p.values?.some((v) => v.meaning) && (
                  <ul>
                    {p.values.map((v) => (
                      <li key={v.value}>
                        <code>{v.value}</code> {v.meaning ?? <span className="muted">(not in the glossary)</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          ))}
          <div className="small muted">
            More in the{" "}
            <a href={SEARCH_SPEC} target="_blank" rel="noreferrer">
              FHIR search specification
            </a>
            .
          </div>
        </dl>
      )}
      {current.error && current.status !== 0 && <div className="req-error">{current.error}</div>}
      <div className="req-actions">
        <button type="button" className="btn btn-sm" onClick={() => setShowBody(!showBody)} aria-expanded={showBody}>
          {showBody ? "Hide response" : "Show response"}
        </button>
        <button type="button" className="btn btn-sm" onClick={copy} title="curl command using $FHIR_BASE_URL and $FHIR_TOKEN from .env">
          {copied ? "Copied ✓" : "Copy as curl"}
        </button>
        {showConsoleLink && (
          <Link className="btn btn-sm" href={consoleHref(current)}>
            Open in console
          </Link>
        )}
      </div>
      {showBody && (
        <div className="req-body">
          {entries.length > 1 && (
            <div className="req-pages" role="group" aria-label="Page">
              {entries.map((e, i) => (
                <button key={e.id} type="button" className="btn btn-sm" aria-pressed={i === page} onClick={() => setPage(i)}>
                  Page {i + 1}
                </button>
              ))}
            </div>
          )}
          {current.requestBody !== undefined && (
            <>
              <h4>Request body</h4>
              <JsonTree value={current.requestBody} />
            </>
          )}
          <h4>Response{current.location ? <span className="muted small"> · Location: {displayUrl(current.location)}</span> : null}</h4>
          {current.responseBody === undefined ? <p className="muted small">No body.</p> : <JsonTree value={current.responseBody} />}
        </div>
      )}
    </div>
  );
}
