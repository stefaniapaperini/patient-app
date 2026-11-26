"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RequestCard } from "@/components/inspector/RequestCard";
import { FhirError, fhirRequest, nextLink, proxyUrl } from "@/lib/fhir/client";
import type { Bundle } from "@/lib/fhir/types";
import { explainRequest } from "@/lib/inspector/explain";
import { PARAMS, specUrl } from "@/lib/inspector/glossary";
import type { LogEntry } from "@/lib/inspector/store";

const METHODS = ["GET", "POST", "PUT"] as const;
type Method = (typeof METHODS)[number];

const TYPES = ["Patient", "Observation", "Condition", "MedicationRequest", "Medication"];

/** Search parameters worth suggesting for each resource type (all standard FHIR R4). */
const TYPE_PARAMS: Record<string, string[]> = {
  Patient: ["name", "family", "given", "gender", "birthdate", "_id"],
  Observation: ["subject", "code", "date", "category", "status"],
  Condition: ["patient", "clinical-status", "code"],
  MedicationRequest: ["patient", "status", "_include=MedicationRequest:medication"],
  Medication: ["code", "_id"],
};
const COMMON_PARAMS = ["_count", "_sort", "_total=accurate", "_summary=count", "_elements"];

const EXAMPLES: { label: string; method: Method; url: string; body?: string }[] = [
  { label: "Five patients", method: "GET", url: "Patient?_count=5" },
  { label: "Patients whose name starts with “wil”", method: "GET", url: "Patient?name=wil" },
  { label: "Name contains “rit” (refused by this server)", method: "GET", url: "Patient?name:contains=rit" },
  { label: "Latest heart rates", method: "GET", url: "Observation?code=8867-4&_sort=-date&_count=5" },
  { label: "How many temperature readings exist", method: "GET", url: "Observation?code=8310-5,8331-1&_summary=count" },
  { label: "Active conditions", method: "GET", url: "Condition?clinical-status=active&_count=5" },
  { label: "Prescriptions with their Medication", method: "GET", url: "MedicationRequest?_include=MedicationRequest:medication&_count=5" },
  { label: "A resource type the app doesn’t allow (403)", method: "GET", url: "Practitioner?_count=5" },
  {
    label: "Create a patient (writes to the server!)",
    method: "POST",
    url: "Patient",
    body: JSON.stringify(
      { resourceType: "Patient", name: [{ use: "official", given: ["Test"], family: "Console" }], gender: "unknown", birthDate: "2000-01-01" },
      null,
      2,
    ),
  },
];

/**
 * "[base]/Patient?x", "<this app's origin>/api/fhir/Patient?x", "/api/fhir/Patient?x", "/Patient?x"
 * or "Patient?x" -> "Patient?x". A paging link "/api/fhir?_getpages=..." -> "?_getpages=...".
 * Only this app's own origin is stripped: a URL on another host stays absolute and send() refuses it,
 * so it is never quietly run against this server.
 */
function cleanUrl(u: string): string {
  let s = u.trim().replace(/^\[base\]/, "");
  const origin = typeof window === "undefined" ? undefined : window.location.origin;
  if (origin && s.toLowerCase().startsWith(origin.toLowerCase() + "/")) s = s.slice(origin.length);
  return s
    .replace(/^\/*api\/fhir(?=[/?]|$)/, "")
    .replace(/^\/+/, "");
}

export default function ConsolePage() {
  return (
    <Suspense fallback={null}>
      <Console />
    </Suspense>
  );
}

function Console() {
  const params = useSearchParams();
  const [method, setMethod] = useState<Method>("GET");
  const [url, setUrl] = useState("Patient?_count=5");
  const [body, setBody] = useState("");
  /** The last response, kept here (not in the request log, which only records while the inspector is on). */
  const [result, setResult] = useState<LogEntry>();
  const [seq, setSeq] = useState(0);
  const [sending, setSending] = useState(false);
  const [inputError, setInputError] = useState<string>();
  /** A write (POST/PUT) filled in from a link: any website can link here, so it is confirmed first. */
  const [prefilledWrite, setPrefilledWrite] = useState(false);

  // Fill the form from links such as "Open in console" (?method=GET&url=...&body=...).
  const paramKey = params.toString();
  useEffect(() => {
    const u = params.get("url");
    if (u === null) return;
    const m = (params.get("method") ?? "GET").toUpperCase();
    const allowed = (METHODS as readonly string[]).includes(m) ? (m as Method) : "GET";
    setMethod(allowed);
    setPrefilledWrite(allowed !== "GET");
    setUrl(cleanUrl(u));
    setBody(params.get("body") ?? "");
    setResult(undefined);
    setInputError(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramKey]);

  const explained = useMemo(() => (cleanUrl(url) ? explainRequest(method, cleanUrl(url)) : undefined), [method, url]);
  const type = explained?.resourceType && TYPES.includes(explained.resourceType) ? explained.resourceType : undefined;

  const last = result;
  const next = last?.responseBody && (last.responseBody as Bundle).resourceType === "Bundle" ? nextLink(last.responseBody as Bundle) : undefined;

  const send = async (overrideUrl?: string) => {
    setInputError(undefined);
    const target = overrideUrl ?? cleanUrl(url);
    // "Next page" always follows a link with GET, whatever the method box says.
    const m: Method = overrideUrl ? "GET" : method;
    let json: unknown;
    if (m !== "GET") {
      try {
        json = JSON.parse(body);
      } catch (e) {
        setInputError(`The body is not valid JSON: ${(e as Error).message}`);
        return;
      }
    }
    if (!overrideUrl && prefilledWrite && m !== "GET") {
      const ok = window.confirm(
        `This ${m} request was filled in from a link and will change data on the FHIR server:\n\n${m} ${target}\n\nOnly send it if you wrote or checked it yourself. Send it?`,
      );
      if (!ok) return;
      setPrefilledWrite(false);
    }
    if (!overrideUrl && /^[a-z][a-z0-9+.-]*:/i.test(target)) {
      setInputError("The console only sends requests through this app’s proxy. Enter a path such as Patient?_count=5.");
      return;
    }
    let proxied: string;
    try {
      proxied = proxyUrl(target);
    } catch (e) {
      setInputError((e as Error).message);
      return;
    }
    setSending(true);
    const id = seq + 1;
    setSeq(id);
    const started = performance.now();
    const base: LogEntry = { id, method: m, url: proxied, startedAt: Date.now(), requestBody: json };
    try {
      const res = await fhirRequest(target, { method: m, json });
      setResult({ ...base, status: res.status, responseBody: res.body, location: res.location, durationMs: Math.round(performance.now() - started) });
    } catch (e) {
      const fe = e instanceof FhirError ? e : undefined;
      setResult({
        ...base,
        status: fe?.status ?? 0,
        responseBody: fe?.outcome,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Math.round(performance.now() - started),
      });
    } finally {
      setSending(false);
    }
  };

  const addParam = (p: string) => {
    const u = cleanUrl(url);
    const sep = u.includes("?") ? (u.endsWith("?") || u.endsWith("&") ? "" : "&") : "?";
    setUrl(u + sep + (p.includes("=") ? p : `${p}=`));
    document.getElementById("console-url")?.focus();
  };

  return (
    <>
      <div className="card">
        <div className="card-header">
          <h1>FHIR Console</h1>
          <span className="muted small">
            Send your own requests to the FHIR server, like Postman. They go through the app’s proxy, so the token stays on
            the server.
          </span>
        </div>

        <form
          className="console-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="console-line">
            <select className="select" aria-label="HTTP method" value={method} onChange={(e) => setMethod(e.target.value as Method)}>
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <span className="console-base">[base]/</span>
            <input
              id="console-url"
              className="input console-url"
              aria-label="Request path and query, after the server base URL"
              list="console-suggest"
              spellCheck={false}
              autoComplete="off"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Patient?name=smith"
            />
            <datalist id="console-suggest">
              {TYPES.map((t) => (
                <option key={t} value={`${t}?_count=10`} />
              ))}
              {EXAMPLES.filter((x) => x.method === "GET").map((x) => (
                <option key={x.url} value={x.url}>
                  {x.label}
                </option>
              ))}
            </datalist>
            <button type="submit" className="btn btn-primary" disabled={sending}>
              {sending && <span className="spinner" aria-hidden />}
              Send
            </button>
          </div>

          <div className="console-hints">
            <span className="small muted">{type ? `${type} search parameters:` : "Resource types:"}</span>
            {type
              ? [...TYPE_PARAMS[type], ...COMMON_PARAMS].map((p) => (
                  <button key={p} type="button" className="chip" onClick={() => addParam(p)} title={PARAMS[p.split("=")[0]] ?? ""}>
                    {p.includes("=") ? p : `${p}=`}
                  </button>
                ))
              : TYPES.map((t) => (
                  <button key={t} type="button" className="chip" onClick={() => setUrl(`${t}?`)}>
                    {t}
                  </button>
                ))}
            {type && (
              <a className="small" href={`${specUrl(type)}#search`} target="_blank" rel="noreferrer">
                all {type} parameters ↗
              </a>
            )}
          </div>

          {method !== "GET" && (
            <div className="field">
              <label htmlFor="console-body">Request body (JSON)</label>
              <textarea
                id="console-body"
                className="input console-body"
                spellCheck={false}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
                placeholder={'{ "resourceType": "Patient", … }'}
              />
              <span className="hint">
                This writes to the shared FHIR server. The proxy only allows POST Patient (create) and PUT Patient/{"{id}"} (update).
              </span>
            </div>
          )}
          {inputError && <div className="req-error">{inputError}</div>}
        </form>

        {explained && !result && (
          <div className="console-preview">
            <h2 className="small muted">What this request will do</h2>
            <p>
              <b>{explained.interaction}</b>
              {explained.resourceType && <> on {explained.resourceType}</>}.
            </p>
            {explained.params.length > 0 && (
              <ul className="small">
                {explained.params.map((p, i) => (
                  <li key={i}>
                    <code>{p.name}</code>: {p.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {last && (
        <div className="card">
          <div className="card-header">
            <h2>Response</h2>
            <div className="toolbar">
              {next && (
                <button type="button" className="btn btn-sm" onClick={() => void send(next)} disabled={sending}>
                  Next page →
                </button>
              )}
              <button type="button" className="btn btn-sm" onClick={() => setResult(undefined)}>
                Clear
              </button>
            </div>
          </div>
          <RequestCard key={last.id} entries={[last]} defaultOpen showConsoleLink={false} />
        </div>
      )}

      <div className="card">
        <h2 style={{ marginBottom: "0.6rem" }}>Examples</h2>
        <ul className="examples">
          {EXAMPLES.map((x) => (
            <li key={x.label}>
              <button
                type="button"
                className="btn-link btn"
                onClick={() => {
                  setMethod(x.method);
                  setUrl(x.url);
                  setBody(x.body ?? "");
                  setResult(undefined);
                  setInputError(undefined);
                }}
              >
                {x.label}
              </button>{" "}
              <code className="small">
                {x.method} {x.url}
              </code>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
