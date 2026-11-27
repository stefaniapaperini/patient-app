"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { InspectButton, inspectable } from "@/components/inspector/Inspect";
import { PatientFormModal } from "@/components/PatientFormModal";
import { Empty, ErrorBanner, Loading } from "@/components/ui";
import { formatDate, formatGender, formatName } from "@/lib/fhir/format";
import type { Patient } from "@/lib/fhir/types";
import type { InspectTarget } from "@/lib/inspector/store";
import { useInspectorEnabled } from "@/lib/inspector/store";
import { usePatientSearch } from "@/lib/usePatientSearch";

export default function PatientListPage() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [term, setTerm] = useState("");
  const [editing, setEditing] = useState<Patient | "new" | null>(null);
  const [notice, setNotice] = useState<string>();
  const { patients, total, totalIsUpperBound, mode, hasMore, loading, loadingMore, error, moreError, loadMore, reload, requestUrl } =
    usePatientSearch(term);
  const startsWith = mode === "startsWith";
  const inspecting = useInspectorEnabled();
  const rowTarget = (p: Patient) => (): InspectTarget => ({
    title: `Patient row: ${formatName(p)}`,
    description:
      "This row is one Patient resource from a search Bundle. The name comes from name[0] (given + family), then gender and birthDate.",
    requests: requestUrl ? [requestUrl] : [],
    resources: [p],
    highlight: ["name", "gender", "birthDate"],
  });
  const listTarget = (): InspectTarget => ({
    title: "Patient list",
    description:
      "The list is a FHIR search on Patient. The server returns a Bundle of 50 patients per page; scrolling follows the Bundle’s “next” link.",
    requests: requestUrl ? [requestUrl] : [],
  });

  // Debounce the search input.
  useEffect(() => {
    const t = setTimeout(() => setTerm(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  // Infinite scroll: load the next page when the sentinel at the bottom of the table scrolls into view.
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    // After a failed page, wait for the Retry button: re-observing would retry at once, in a loop.
    if (!el || !hasMore || moreError) return;
    const io = new IntersectionObserver((es) => es[0].isIntersecting && loadMore(), {
      root: scrollRef.current,
      rootMargin: "200px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, moreError, loadMore, patients.length]);

  const open = (p: Patient) => router.push(`/patient/${encodeURIComponent(p.id!)}`);

  const onSaved = (saved: Patient) => {
    const wasNew = editing === "new";
    setEditing(null);
    setNotice(`${formatName(saved)} was ${wasNew ? "created" : "updated"}.`);
    reload();
  };

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(undefined), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <>
      <div className="card">
        <div className="card-header">
          <h1>
            Patients
            <InspectButton enabled={inspecting} target={listTarget} label="the patient search" />
            {!loading && !error && total !== undefined && (
              <span className="sub">
                {term
                  ? `${totalIsUpperBound ? "up to " : ""}${total} match${total === 1 && !totalIsUpperBound ? "" : "es"}`
                  : `${total} total`}
                {patients.length < total ? ` · showing ${patients.length}` : ""}
              </span>
            )}
          </h1>
          <div className="toolbar">
            <div className="search">
              <input
                className="input"
                type="search"
                placeholder={startsWith ? "Name starts with…" : "Search by name…"}
                aria-label={startsWith ? "Search patients by the start of a name" : "Search patients by name"}
                aria-describedby={startsWith ? "search-hint" : undefined}
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
            </div>
            <button className="btn btn-primary" onClick={() => setEditing("new")}>
              + New patient
            </button>
          </div>
        </div>

        {startsWith && (
          <p id="search-hint" className="muted small search-hint">
            This FHIR server only matches the start of a name: a search finds patients whose first, middle or last
            name begins with what you type, so “ar” finds Arthur but not Cartwright.
          </p>
        )}

        {notice && (
          <div className="alert alert-success" role="status" style={{ marginBottom: "1rem" }}>
            <div>{notice}</div>
            <button className="icon-btn" aria-label="Dismiss" onClick={() => setNotice(undefined)}>
              ×
            </button>
          </div>
        )}

        {error ? (
          <ErrorBanner title="Could not load patients" message={error} onRetry={reload} />
        ) : loading && patients.length === 0 ? (
          <Loading label={term ? `Searching for “${term}”…` : "Loading patients…"} />
        ) : patients.length === 0 ? (
          <Empty>
            {!term
              ? "No patients on the server yet."
              : startsWith
                ? `No patient has a first, middle or last name starting with “${term}”.`
                : `No patients match “${term}”.`}
          </Empty>
        ) : (
          <div className="table-wrap scroll-15" ref={scrollRef} aria-busy={loading}>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Gender</th>
                  <th>Date of birth</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody style={{ opacity: loading ? 0.5 : 1 }}>
                {patients.map((p) => (
                  <tr
                    key={p.id}
                    className="clickable"
                    tabIndex={0}
                    onClick={() => open(p)}
                    onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && open(p)}
                    aria-label={`Open ${formatName(p)}`}
                    {...inspectable(inspecting, rowTarget(p))}
                  >
                    <td>{formatName(p)}</td>
                    <td>{formatGender(p.gender)}</td>
                    <td className="num">{formatDate(p.birthDate)}</td>
                    <td className="actions">
                      <InspectButton enabled={inspecting} target={rowTarget(p)} label={formatName(p)} />
                      <button
                        className="btn btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditing(p);
                        }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {hasMore && (
              <div ref={sentinelRef} className="load-more">
                {moreError ? (
                  <span style={{ color: "var(--danger)" }}>
                    {moreError}{" "}
                    <button className="btn btn-link" onClick={loadMore}>
                      Retry
                    </button>
                  </span>
                ) : loadingMore ? (
                  <>
                    <span className="spinner" aria-hidden /> Loading more…
                  </>
                ) : (
                  <button className="btn btn-link" onClick={loadMore}>
                    Load more
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {editing && (
        <PatientFormModal
          patient={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </>
  );
}
