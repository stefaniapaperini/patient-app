"use client";

import { useMemo, useState } from "react";
import { Empty, ErrorBanner, Loading, Segmented } from "./ui";
import { InspectButton, inspectable } from "./inspector/Inspect";
import { fetchAllPages, matches } from "@/lib/fhir/client";
import {
  capitalize,
  clinicalStatusCode,
  codeLabel,
  codeText,
  conditionOnset,
  conditionOnsetKey,
  isConditionActive,
} from "@/lib/fhir/format";
import type { Condition } from "@/lib/fhir/types";
import { useInspector, type InspectTarget } from "@/lib/inspector/store";
import { useAsync } from "@/lib/useAsync";

type StatusFilter = "active" | "inactive" | "all";

export function ConditionsSection({ patientId }: { patientId: string }) {
  const [status, setStatus] = useState<StatusFilter>("active");
  const [text, setText] = useState("");
  const query = `Condition?${new URLSearchParams({ patient: patientId, _count: "200" })}`;
  const { enabled: inspecting } = useInspector();
  const { data, loading, error, reload } = useAsync(
    async (signal) => {
      const { entries } = await fetchAllPages<Condition>(query, { signal });
      return matches<Condition>(entries, "Condition").filter(
        (c) => c.verificationStatus?.coding?.[0]?.code !== "entered-in-error",
      );
    },
    [patientId],
  );

  const counts = useMemo(() => {
    const all = data ?? [];
    const active = all.filter(isConditionActive).length;
    return { active, inactive: all.length - active, all: all.length };
  }, [data]);

  const rows = useMemo(() => {
    const q = text.trim().toLowerCase();
    return (data ?? [])
      .filter((c) => status === "all" || (status === "active") === isConditionActive(c))
      .filter((c) => !q || codeText(c.code).toLowerCase().includes(q) || codeLabel(c.code).toLowerCase().includes(q))
      .sort((a, b) => conditionOnsetKey(b).localeCompare(conditionOnsetKey(a)));
  }, [data, status, text]);

  return (
    <section className="card" aria-labelledby="cond-h">
      <div className="card-header">
        <h2 id="cond-h">
          Conditions &amp; diagnoses
          <InspectButton
            enabled={inspecting}
            label="the conditions search"
            target={() => ({
              title: "Conditions section",
              description:
                "A search for every Condition of this patient. The Active / Not active filter and the text filter run in the browser, on clinicalStatus and the code.",
              requests: [query],
            })}
          />
        </h2>
        <div className="toolbar">
          <div className="search" style={{ minWidth: 220 }}>
            <input
              className="input"
              type="search"
              placeholder="Filter conditions…"
              aria-label="Filter conditions by name or code"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <Segmented<StatusFilter>
            label="Clinical status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "active", label: `Active${data ? ` (${counts.active})` : ""}` },
              { value: "inactive", label: `Not active${data ? ` (${counts.inactive})` : ""}` },
              { value: "all", label: `All${data ? ` (${counts.all})` : ""}` },
            ]}
          />
        </div>
      </div>
      {loading ? (
        <Loading label="Loading conditions…" />
      ) : error ? (
        <ErrorBanner title="Could not load conditions" message={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <Empty>
          {data?.length === 0
            ? "No conditions recorded for this patient."
            : text
              ? "No conditions match this filter."
              : status === "active"
                ? "No active conditions."
                : "No conditions in this category."}
        </Empty>
      ) : (
        <div className="table-wrap scroll-md">
          <table>
            <thead>
              <tr>
                <th>Condition</th>
                <th>Code</th>
                <th>Onset date</th>
                <th>Clinical status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => {
                const target = (): InspectTarget => ({
                  title: `Condition: ${codeText(c.code)}`,
                  description:
                    "One Condition resource. The name and code come from Condition.code (SNOMED CT), the onset from onset[x], the status from clinicalStatus.",
                  requests: [query],
                  resources: [c],
                  highlight: ["code", "onsetDateTime", "onsetPeriod", "onsetAge", "onsetString", "clinicalStatus"],
                });
                return (
                <tr key={c.id ?? i} {...inspectable(inspecting, target)}>
                  <td className="wrap">
                    {codeText(c.code)}
                    <InspectButton enabled={inspecting} target={target} label={codeText(c.code)} />
                  </td>
                  <td className="muted small">
                    {codeLabel(c.code)}
                  </td>
                  <td className="num">{conditionOnset(c)}</td>
                  <td>
                    <span className={`badge ${isConditionActive(c) ? "badge-active" : ""}`}>
                      {capitalize(clinicalStatusCode(c) || undefined)}
                    </span>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
