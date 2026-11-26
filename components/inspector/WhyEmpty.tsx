"use client";

import { useState } from "react";
import { errorMessage, fetchAllPages, proxyUrl } from "@/lib/fhir/client";
import type { Observation } from "@/lib/fhir/types";
import { codeMeaning } from "@/lib/inspector/glossary";
import { entriesFor, useInspector } from "@/lib/inspector/store";
import { RequestCard } from "./RequestCard";

interface CodeCount {
  system?: string;
  code: string;
  display?: string;
  count: number;
  wanted: boolean;
}

/**
 * For an empty vital-sign chart: fetch every Observation of the patient *without* the code filter
 * and list the codes it has. If none of the chart's codes is there, the data is missing on the
 * server; if some are, the query or the app's processing is the problem.
 */
export function WhyEmpty({ patientId, label, codes }: { patientId: string; label: string; codes: string[] }) {
  const { log } = useInspector();
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "done"; total: number; rows: CodeCount[]; truncated: boolean }
  >({ kind: "idle" });
  const query = `Observation?${new URLSearchParams({ subject: `Patient/${patientId}`, _elements: "code", _count: "200" })}`;

  const run = async () => {
    setState({ kind: "loading" });
    try {
      const { entries, truncated } = await fetchAllPages<Observation>(query);
      const counts = new Map<string, CodeCount>();
      let total = 0;
      for (const e of entries) {
        const o = e.resource;
        if (o?.resourceType !== "Observation") continue;
        total++;
        for (const c of o.code?.coding ?? []) {
          if (!c.code) continue;
          const k = `${c.system}|${c.code}`;
          const row = counts.get(k) ?? { system: c.system, code: c.code, display: c.display, count: 0, wanted: codes.includes(c.code) };
          row.count++;
          counts.set(k, row);
        }
      }
      const rows = [...counts.values()].sort((a, b) => Number(b.wanted) - Number(a.wanted) || b.count - a.count);
      setState({ kind: "done", total, rows, truncated });
    } catch (e) {
      setState({ kind: "error", message: errorMessage(e) });
    }
  };

  const found = state.kind === "done" ? state.rows.filter((r) => r.wanted) : [];

  return (
    <div className="why">
      <h3>Why is “{label}” empty?</h3>
      <p className="small">
        The chart asks the server only for these codes:{" "}
        {codes.map((c, i) => (
          <span key={c}>
            {i > 0 && ", "}
            <code>{c}</code>
            {codeMeaning(c) && <span className="muted"> ({codeMeaning(c)})</span>}
          </span>
        ))}
        . To find out whether the data is missing or the query is wrong, ask for <em>all</em> of this patient’s
        Observations, without the code filter, and see which codes they use.
      </p>
      {state.kind === "idle" && (
        <button type="button" className="btn btn-sm btn-primary" onClick={run}>
          Check the server
        </button>
      )}
      {state.kind === "loading" && (
        <p className="small">
          <span className="spinner" aria-hidden /> Fetching every Observation of this patient…
        </p>
      )}
      {state.kind === "error" && <div className="req-error">{state.message}</div>}
      {state.kind === "done" && (
        <>
          <div className={`verdict ${found.length ? "verdict-query" : "verdict-missing"}`} role="status">
            {state.total === 0 ? (
              <>
                <b>No data.</b> This patient has no Observations at all.
              </>
            ) : found.length === 0 ? (
              <>
                <b>The data is missing, not the query.</b> None of this patient’s {state.total} Observations uses
                these codes, so the server has nothing to show in this chart.
              </>
            ) : (
              <>
                <b>The data exists: look at the query or the processing.</b> {found.reduce((s, r) => s + r.count, 0)}{" "}
                Observation(s) use these codes, yet the chart is empty. Check them in the table below and the full
                resources in the console: a missing <code>valueQuantity</code>, status <code>entered-in-error</code> or
                no date makes the app skip a reading.
              </>
            )}
            {state.truncated && <div className="small">Only the first pages were checked: this patient has very many Observations.</div>}
          </div>
          {state.rows.length > 0 && (
            <div className="table-wrap" style={{ maxHeight: 260 }}>
              <table className="compact">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Meaning (from the server)</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {state.rows.map((r) => (
                    <tr key={`${r.system}|${r.code}`} className={r.wanted ? "row-wanted" : undefined}>
                      <td>
                        <code>{r.code}</code>
                      </td>
                      <td className="wrap">{r.display ?? <span className="muted">no display</span>}</td>
                      <td className="num">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h4>The request used for this check</h4>
          <RequestCard entries={entriesFor(log, proxyUrl(query))} />
          <button type="button" className="btn btn-sm" onClick={run} style={{ marginTop: "0.5rem" }}>
            Check again
          </button>
        </>
      )}
    </div>
  );
}
