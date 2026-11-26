"use client";

import { useEffect, useMemo, useState } from "react";
import { errorMessage, fhirFetch, proxyUrl } from "@/lib/fhir/client";
import type { Resource } from "@/lib/fhir/types";
import { specUrl } from "@/lib/inspector/glossary";
import {
  clearLog,
  closePanel,
  openPanel,
  entriesFor,
  selectLog,
  useInspector,
  type InspectTarget,
  type LogEntry,
  type PanelView,
} from "@/lib/inspector/store";
import { JsonTree } from "./JsonTree";
import { LearnTab } from "./LearnTab";
import { displayUrl, RequestCard, statusClass, statusText } from "./RequestCard";
import { WhyEmpty } from "./WhyEmpty";

const TITLES: Record<PanelView, string> = {
  element: "FHIR data",
  log: "Request log",
  learn: "Learn FHIR",
};

/**
 * The side panel. It shows one view at a time, each with its own title: the FHIR data behind an
 * inspected element, the request log, or the FHIR basics. Views link to each other where useful.
 */
export function InspectorPanel() {
  const { enabled, panelOpen, view, target, targetSeq, log } = useInspector();
  const open = enabled && panelOpen;

  // Leave room for the panel so it doesn't cover the page.
  useEffect(() => {
    document.documentElement.classList.toggle("inspector-open", open);
    return () => document.documentElement.classList.remove("inspector-open");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // A modal dialog handles its own Escape.
      if (e.key === "Escape" && !document.querySelector(".modal-backdrop")) closePanel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  const title = view === "element" && target ? target.title : TITLES[view];
  return (
    <aside className="inspector" aria-labelledby="inspector-title">
      <div className="inspector-head">
        <div>
          {view === "element" && <div className="inspector-kicker">FHIR data behind</div>}
          <h2 id="inspector-title">{title}</h2>
        </div>
        <button type="button" className="icon-btn" aria-label={`Close ${TITLES[view].toLowerCase()}`} onClick={closePanel}>
          ×
        </button>
      </div>
      <div className="inspector-body">
        {/* Keyed by inspect count: every inspect starts fresh, so its highlighted fields are expanded
            even when the same resource was shown before with other highlights. */}
        {view === "element" && <ElementTab key={targetSeq} target={target} log={log} />}
        {view === "log" && <LogTab log={log} />}
        {view === "learn" && <LearnTab />}
      </div>
    </aside>
  );
}

function ElementTab({ target, log }: { target: InspectTarget | null; log: LogEntry[] }) {
  if (!target) {
    return (
      <div className="muted">
        <p>
          <b>Right-click</b> any outlined part of the page, or press its <span className="inspect-btn static">ⓘ</span>{" "}
          button, to see the FHIR request and resources it was built from.
        </p>
        <p className="small">
          Every request the app makes while the inspector is on is also in the{" "}
          <button type="button" className="btn btn-link" onClick={() => openPanel("log")}>
            request log
          </button>
          .
        </p>
      </div>
    );
  }
  return (
    <div className="insp-element">
      {target.description && <p className="small">{target.description}</p>}

      {target.emptyVital && <WhyEmpty key={target.emptyVital.label + target.emptyVital.patientId} {...target.emptyVital} />}

      <h4 className="insp-step">
        <span>1</span> The request{target.requests.length > 1 ? "s" : ""} the app sent
      </h4>
      {target.requests.map((r) => {
        const entries = entriesFor(log, proxyUrl(r));
        return entries.length ? (
          <RequestCard key={r} entries={entries} />
        ) : (
          <MissingRequest key={r} request={r} />
        );
      })}

      {target.resources && target.resources.length > 0 && (
        <>
          <h4 className="insp-step">
            <span>2</span> The resource{target.resources.length > 1 ? `s (${target.resources.length})` : ""} behind it
          </h4>
          {target.highlight?.length ? (
            <p className="small muted">
              <span className="json-hl legend-hl">Highlighted</span> fields are the ones shown on the page. Hover a field
              name for an explanation.
            </p>
          ) : null}
          {target.resources.map((r, i) => (
            <ResourceBlock key={`${r.resourceType}/${r.id ?? i}`} resource={r} highlight={target.highlight} defaultOpen={i < 2} />
          ))}
        </>
      )}

      <p className="small muted insp-more">
        New to FHIR?{" "}
        <button type="button" className="btn btn-link" onClick={() => openPanel("learn")}>
          Learn the basics
        </button>{" "}
        · All requests are in the{" "}
        <button type="button" className="btn btn-link" onClick={() => openPanel("log")}>
          request log
        </button>
        .
      </p>
    </div>
  );
}

/**
 * A request that isn't in the log: it ran before the inspector was switched on (nothing is
 * recorded while it's off), or the log was cleared or had dropped it. Run it again (these are
 * all GET searches and reads) so it can be shown; the log entry then appears and replaces this.
 */
function MissingRequest({ request }: { request: string }) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error"; message: string }>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    // Only the first page: the page itself may have loaded just that, and later pages are grouped under it in the log.
    fhirFetch(request).catch((e) => !cancelled && setState({ kind: "error", message: errorMessage(e) }));
    return () => {
      cancelled = true;
    };
  }, [request]);
  return (
    <div className="req small muted">
      <code>{displayUrl(proxyUrl(request))}</code>
      {state.kind === "loading" ? (
        <p>
          <span className="spinner" aria-hidden />
          This request ran before the inspector was switched on (or the log was cleared), so it wasn’t recorded.
          Sending it again…
        </p>
      ) : (
        <div className="req-error">Sending it again failed: {state.message}</div>
      )}
    </div>
  );
}

function ResourceBlock({ resource, highlight, defaultOpen }: { resource: Resource; highlight?: string[]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="res-block">
      <div className="res-head">
        <button type="button" className="json-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "▾" : "▸"}
        </button>
        <code>
          {resource.resourceType}/{resource.id ?? "(no id)"}
        </code>
        <a className="small" href={specUrl(resource.resourceType)} target="_blank" rel="noreferrer">
          {resource.resourceType} in the FHIR spec ↗
        </a>
      </div>
      {open && <JsonTree value={resource} highlight={highlight} defaultDepth={1} />}
    </div>
  );
}

function LogTab({ log }: { log: LogEntry[] }) {
  const { selectedLogId } = useInspector();
  const [filter, setFilter] = useState("");
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return [...log].reverse().filter((e) => !q || e.url.toLowerCase().includes(q) || e.method.toLowerCase() === q || String(e.status) === q);
  }, [log, filter]);

  return (
    <div>
      <p className="small muted">
        Every request this page made to the FHIR server, newest first, like Postman’s history. Select one to see what each
        parameter means and the full response.
      </p>
      <div className="toolbar" style={{ marginBottom: "0.6rem" }}>
        <input
          className="input"
          style={{ flex: 1 }}
          type="search"
          placeholder="Filter: Patient, Observation, POST, 404…"
          aria-label="Filter the request log"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button type="button" className="btn btn-sm" onClick={clearLog} disabled={log.length === 0}>
          Clear
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="muted small">No requests {filter ? "match this filter" : "yet"}.</p>
      ) : (
        <ul className="log">
          {rows.map((e) => {
            const sel = e.id === selectedLogId;
            return (
              <li key={e.id} className={sel ? "selected" : undefined}>
                <button type="button" className="log-row" aria-expanded={sel} onClick={() => selectLog(sel ? null : e.id)}>
                  <span className={statusClass(e.status)}>{statusText(e)}</span>
                  <span className="req-method">{e.method}</span>
                  <span className="log-url">{displayUrl(e.url)}</span>
                  <span className="log-time">{e.durationMs !== undefined ? `${e.durationMs} ms` : "…"}</span>
                </button>
                {sel && (
                  <div className="log-detail">
                    <div className="small muted">
                      {new Date(e.startedAt).toLocaleTimeString()}
                      {e.group && e.group !== e.url ? " · a later page of a multi-page search" : ""}
                    </div>
                    <RequestCard entries={[e]} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
