"use client";

import { useMemo, useState } from "react";
import { Empty, ErrorBanner, Loading, Segmented } from "./ui";
import { CodeChip } from "./inspector/CodeChip";
import { InspectButton, inspectable } from "./inspector/Inspect";
import { fetchAllPages, fhirFetch, matches } from "@/lib/fhir/client";
import { capitalize, formatDate, formatDose, formatFrequency, formatRoute } from "@/lib/fhir/format";
import { includedMedications, isMedicationActive, medicationName, normalizeRef, serverBase, unresolvedRefs } from "@/lib/fhir/medications";
import type { Medication, MedicationRequest } from "@/lib/fhir/types";
import { useInspectorEnabled, type InspectTarget } from "@/lib/inspector/store";
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
  // _include asks the server to return referenced Medication resources in the same Bundle.
  const query = `MedicationRequest?${new URLSearchParams({ patient: patientId, _include: "MedicationRequest:medication", _count: "200" })}`;
  const inspecting = useInspectorEnabled();
  const { data, loading, error, reload } = useAsync(
    async (signal) => {
      const { entries } = await fetchAllPages<MedicationRequest>(query, { signal });
      const requests = matches<MedicationRequest>(entries, "MedicationRequest");
      const known = includedMedications(entries);
      const base = serverBase(entries);

      // Fallback: GET any referenced Medication the server did not include.
      const missing = unresolvedRefs(requests, known, base);
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
      // Referenced Medications fetched one by one (not returned by _include): the inspector shows those GETs too.
      return { requests, known, base, failed, fetchedSeparately: new Set(missing) };
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
      .map((r) => ({ r, name: medicationName(r, data.known, data.base), dosage: r.dosageInstruction?.[0] }))
      .sort(
        (a, b) =>
          Number(isMedicationActive(b.r)) - Number(isMedicationActive(a.r)) ||
          (b.r.authoredOn ?? "").localeCompare(a.r.authoredOn ?? ""),
      );
  }, [data, status]);

  return (
    <section className="card" aria-labelledby="med-h">
      <div className="card-header">
        <h2 id="med-h">
          Medications
          <InspectButton
            enabled={inspecting}
            label="the medications search"
            target={() => ({
              title: "Medications section",
              description:
                "A search for this patient’s MedicationRequests. _include adds the Medication resources they refer to, in the same Bundle (entries with search.mode “include”). Current / All filters on status in the browser.",
              requests: [query],
            })}
          />
        </h2>
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
                  {rows.map(({ r, name, dosage }, i) => {
                    const ref = r.medicationReference?.reference;
                    const med = ref && !ref.startsWith("#") ? data?.known.get(normalizeRef(ref, data?.base)) : undefined;
                    const coding = (r.medicationCodeableConcept ?? med?.code)?.coding?.find((c) => c.code);
                    const target = (): InspectTarget => ({
                      title: `Medication: ${name}`,
                      description: med
                        ? "The prescription (MedicationRequest) refers to a separate Medication resource through medicationReference, so the name comes from that Medication’s code."
                        : "One MedicationRequest. The name comes from medicationCodeableConcept, the dose, frequency and route from dosageInstruction[0].",
                      requests:
                        ref && data?.fetchedSeparately.has(normalizeRef(ref, data?.base)) ? [query, normalizeRef(ref, data?.base)] : [query],
                      resources: med ? [r, med] : [r],
                      highlight: ["medicationCodeableConcept", "medicationReference", "dosageInstruction", "status", "authoredOn", "code"],
                    });
                    return (
                    <tr key={r.id ?? i} {...inspectable(inspecting, target)}>
                      <td className="wrap">
                        {name}
                        {inspecting && <CodeChip {...coding} />}
                        <InspectButton enabled={inspecting} target={target} label={name} />
                      </td>
                      <td className="num">{formatDose(dosage)}</td>
                      <td>{formatFrequency(dosage)}</td>
                      <td>{formatRoute(dosage)}</td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[r.status ?? ""] ?? ""}`}>{capitalize(r.status)}</span>
                      </td>
                      <td className="num muted">{formatDate(r.authoredOn)}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
