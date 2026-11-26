"use client";

import { useMemo, useState } from "react";
import { Empty, ErrorBanner, Loading, Segmented } from "./ui";
import { fetchAllPages, fhirFetch, matches } from "@/lib/fhir/client";
import { capitalize, formatDate, formatDose, formatFrequency, formatRoute } from "@/lib/fhir/format";
import { includedMedications, isMedicationActive, medicationName, unresolvedRefs } from "@/lib/fhir/medications";
import type { Medication, MedicationRequest } from "@/lib/fhir/types";
import { useAsync } from "@/lib/useAsync";

type StatusFilter = "active" | "all";

const STATUS_BADGE: Record<string, string> = {
  active: "badge-active",
  "on-hold": "badge-warn",
  cancelled: "badge-danger",
  "entered-in-error": "badge-danger",
};

/** Fetch at most this many separately-referenced Medications at once. */
const CONCURRENCY = 6;

export function MedicationsSection({ patientId }: { patientId: string }) {
  const [status, setStatus] = useState<StatusFilter>("active");
  const { data, loading, error, reload } = useAsync(
    async (signal) => {
      // _include asks the server to return referenced Medication resources in the same Bundle.
      const q = new URLSearchParams({ patient: patientId, _include: "MedicationRequest:medication", _count: "200" });
      const { entries } = await fetchAllPages<MedicationRequest>(`MedicationRequest?${q}`, { signal });
      const requests = matches<MedicationRequest>(entries, "MedicationRequest");
      const known = includedMedications(entries);

      // Fallback: GET any referenced Medication the server did not include.
      const missing = unresolvedRefs(requests, known);
      const failed: string[] = [];
      for (let i = 0; i < missing.length; i += CONCURRENCY) {
        await Promise.all(
          missing.slice(i, i + CONCURRENCY).map(async (ref) => {
            try {
              known.set(ref, await fhirFetch<Medication>(ref, { signal }));
            } catch {
              failed.push(ref);
            }
          }),
        );
      }
      return { requests, known, failed };
    },
    [patientId],
  );

  const counts = useMemo(() => {
    const all = data?.requests ?? [];
    return { active: all.filter(isMedicationActive).length, all: all.length };
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.requests
      .filter((r) => status === "all" || isMedicationActive(r))
      .map((r) => ({ r, name: medicationName(r, data.known), dosage: r.dosageInstruction?.[0] }))
      .sort(
        (a, b) =>
          Number(isMedicationActive(b.r)) - Number(isMedicationActive(a.r)) ||
          (b.r.authoredOn ?? "").localeCompare(a.r.authoredOn ?? ""),
      );
  }, [data, status]);

  return (
    <section className="card" aria-labelledby="med-h">
      <div className="card-header">
        <h2 id="med-h">Medications</h2>
        <Segmented<StatusFilter>
          label="Medication status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "active", label: `Current${data ? ` (${counts.active})` : ""}` },
            { value: "all", label: `All${data ? ` (${counts.all})` : ""}` },
          ]}
        />
      </div>
      {loading ? (
        <Loading label="Loading medications…" />
      ) : error ? (
        <ErrorBanner title="Could not load medications" message={error} onRetry={reload} />
      ) : (
        <>
          {data && data.failed.length > 0 && (
            <p className="muted small">
              {data.failed.length} referenced Medication resource{data.failed.length > 1 ? "s" : ""} could not be loaded.
            </p>
          )}
          {rows.length === 0 ? (
            <Empty>
              {counts.all === 0 ? "No medications recorded for this patient." : "No current medications. Choose “All” to see past ones."}
            </Empty>
          ) : (
            <div className="table-wrap scroll-md">
              <table>
                <thead>
                  <tr>
                    <th>Medication</th>
                    <th>Dose</th>
                    <th>Frequency</th>
                    <th>Route</th>
                    <th>Status</th>
                    <th>Prescribed</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ r, name, dosage }, i) => (
                    <tr key={r.id ?? i}>
                      <td className="wrap">{name}</td>
                      <td className="num">{formatDose(dosage)}</td>
                      <td>{formatFrequency(dosage)}</td>
                      <td>{formatRoute(dosage)}</td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[r.status ?? ""] ?? ""}`}>{capitalize(r.status)}</span>
                      </td>
                      <td className="num muted">{formatDate(r.authoredOn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
