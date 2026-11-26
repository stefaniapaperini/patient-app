"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PatientFormModal } from "@/components/PatientFormModal";
import { Empty, ErrorBanner, Loading } from "@/components/ui";
import { formatDate, formatGender, formatName } from "@/lib/fhir/format";
import type { Patient } from "@/lib/fhir/types";
import { usePatientSearch } from "@/lib/usePatientSearch";

export default function PatientListPage() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [term, setTerm] = useState("");
  const [editing, setEditing] = useState<Patient | "new" | null>(null);
  const [notice, setNotice] = useState<string>();
  const { patients, total, hasMore, loading, loadingMore, error, moreError, loadMore, reload } =
    usePatientSearch(term);

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
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((es) => es[0].isIntersecting && loadMore(), {
      root: scrollRef.current,
      rootMargin: "200px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore, patients.length]);

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
            {!loading && !error && total !== undefined && (
              <span className="sub">
                {term ? `${total} match${total === 1 ? "" : "es"}` : `${total} total`}
                {patients.length < total ? ` · showing ${patients.length}` : ""}
              </span>
            )}
          </h1>
          <div className="toolbar">
            <div className="search">
              <input
                className="input"
                type="search"
                placeholder="Search by name…"
                aria-label="Search patients by name"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
            </div>
            <button className="btn btn-primary" onClick={() => setEditing("new")}>
              + New patient
            </button>
          </div>
        </div>

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
          <Empty>{term ? `No patients match “${term}”.` : "No patients on the server yet."}</Empty>
        ) : (
          <div className="table-wrap scroll-10" ref={scrollRef} aria-busy={loading}>
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
                  >
                    <td>{formatName(p)}</td>
                    <td>{formatGender(p.gender)}</td>
                    <td className="num">{formatDate(p.birthDate)}</td>
                    <td className="actions">
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
