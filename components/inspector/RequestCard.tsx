"use client";

import { useState } from "react";
import Link from "next/link";
import { dicomDisplayUrl, explainDicomRequest, explainRequest, isDicomUrl, splitUrl, toCurl, toDicomCurl } from "@/lib/inspector/explain";
import { DICOM_DICTIONARY, DICOM_PART18, dicomTagNotation, SEARCH_SPEC, specUrl } from "@/lib/inspector/glossary";
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

/**
 * "/api/fhir/Patient?x" -> "[base]/Patient?x", the notation the FHIR specification uses;
 * DICOMweb requests show their service: "[QIDO-RS]/studies?…".
 */
export function displayUrl(url: string): string {
  if (isDicomUrl(url)) return dicomDisplayUrl(url);
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
  // QIDO-RS answers with a list of DICOM JSON objects.
  if (Array.isArray(body)) return `${body.length} result${body.length === 1 ? "" : "s"} (DICOM JSON)`;
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
  const dicom = isDicomUrl(first.url);
  const ex = explainRequest(first.method, first.url);
  const dx = dicom ? explainDicomRequest(first.url) : undefined;
  const totalMs = entries.reduce((s, e) => s + (e.durationMs ?? 0), 0);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(dicom ? toDicomCurl(current.url) : toCurl(current.method, current.url, current.requestBody));
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
        {dicom && current.status === 204 && <span>no match (204, empty body)</span>}
      </div>
      {dx ? (
        <DicomExplanation ex={dx} />
      ) : (
        <>
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
        </>
      )}
      {current.error && current.status !== 0 && <div className="req-error">{current.error}</div>}
      <div className="req-actions">
        <button type="button" className="btn btn-sm" onClick={() => setShowBody(!showBody)} aria-expanded={showBody}>
          {showBody ? "Hide response" : "Show response"}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={copy}
          title={dicom ? "curl command using $DICOMWEB_QIDO_URL or $DICOMWEB_WADO_URL from .env" : "curl command using $FHIR_BASE_URL and $FHIR_TOKEN from .env"}
        >
          {copied ? "Copied ✓" : "Copy as curl"}
        </button>
        {/* The console sends FHIR requests only. */}
        {showConsoleLink && !dicom && (
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

/** What a DICOMweb request does: service, level, the UIDs in its path and each query parameter. */
export function DicomExplanation({ ex }: { ex: ReturnType<typeof explainDicomRequest> }) {
  return (
    <>
      <p className="req-what">
        <b>{ex.service}</b>: {ex.interaction}.
      </p>
      {(ex.uids.length > 0 || ex.params.length > 0) && (
        <dl className="req-params">
          {ex.uids.map((u) => (
            <div key={u.tag}>
              <dt>
                <code>{u.value}</code>
              </dt>
              <dd>
                {u.label} UID, tag {dicomTagNotation(u.tag)}: the {u.label.toLowerCase()} is addressed by its globally unique
                id in the path.
              </dd>
            </div>
          ))}
          {ex.params.map((p, i) => (
            <div key={i}>
              <dt>
                <code>
                  {p.name}={p.value.length > 60 ? p.value.slice(0, 60) + "…" : p.value}
                </code>
              </dt>
              <dd>{p.text}</dd>
            </div>
          ))}
          <div className="small muted">
            More in the{" "}
            <a href={DICOM_PART18} target="_blank" rel="noreferrer">
              DICOMweb standard (Part 18)
            </a>{" "}
            and the{" "}
            <a href={DICOM_DICTIONARY} target="_blank" rel="noreferrer">
              tag dictionary
            </a>
            .
          </div>
        </dl>
      )}
    </>
  );
}

/**
 * A rendered image request, explained without a log entry: images are loaded by the browser
 * (an <img>), not through the request log, so scrolling a long series doesn't flood it.
 */
export function ImageRequestCard({ url, alt }: { url: string; alt: string }) {
  const [copied, setCopied] = useState(false);
  const ex = explainDicomRequest(url);
  return (
    <div className="req">
      <div className="req-line">
        <span className="req-method">GET</span>
        <code className="req-url">{dicomDisplayUrl(url)}</code>
      </div>
      <div className="req-meta">
        <span>Accept: image/jpeg</span>
        <span>loaded by the browser, not in the request log</span>
      </div>
      <DicomExplanation ex={ex} />
      <div className="req-actions">
        <button
          type="button"
          className="btn btn-sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(toDicomCurl(url));
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // clipboard blocked
            }
          }}
          title="curl command using $DICOMWEB_WADO_URL from .env"
        >
          {copied ? "Copied ✓" : "Copy as curl"}
        </button>
      </div>
      <div className="req-body">
        <h4>Response: a JPEG image</h4>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="insp-image" src={url} alt={alt} />
      </div>
    </div>
  );
}

