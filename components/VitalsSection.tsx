"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Empty, ErrorBanner, Loading, Segmented } from "./ui";
import { CodeChip } from "./inspector/CodeChip";
import { InspectButton, inspectable } from "./inspector/Inspect";
import { fetchAllPages, matches } from "@/lib/fhir/client";
import { formatDateTime } from "@/lib/fhir/format";
import type { Observation } from "@/lib/fhir/types";
import {
  BP_PANELS,
  chartRows,
  extractReadings,
  SERIES_COLORS,
  unitFor,
  VITALS,
  vitalsQuery,
  type VitalDef,
  type VitalReading,
} from "@/lib/fhir/vitals";
import { useInspectorEnabled, type InspectTarget } from "@/lib/inspector/store";
import { useAsync } from "@/lib/useAsync";

type View = "chart" | "table";

const shortDate = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { year: "2-digit", month: "short", day: "numeric" });

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString());

/** What the inspector needs to explain a vital: the query, the Observations by id, the patient. */
interface InspectCtx {
  enabled: boolean;
  query: string;
  patientId: string;
  observations: Map<string, Observation>;
}

/** The codes a vital's chart is fed by: its series' codes, plus the panel codes for blood pressure. */
function codesFor(def: VitalDef): string[] {
  const codes = def.series.flatMap((s) => s.codes);
  return def.key === "bp" ? [...BP_PANELS, ...codes] : codes;
}

function observationsFor(readings: VitalReading[], observations: Map<string, Observation>): Observation[] {
  const ids = [...new Set(readings.map((r) => r.observationId).filter((x): x is string => !!x))];
  return ids.map((id) => observations.get(id)).filter((o): o is Observation => !!o);
}

export function VitalsSection({ patientId }: { patientId: string }) {
  const [view, setView] = useState<View>("chart");
  const query = vitalsQuery(patientId);
  const enabled = useInspectorEnabled();
  const { data, loading, error, reload } = useAsync(
    async (signal) => {
      const { entries, truncated } = await fetchAllPages<Observation>(query, { signal });
      const list = matches<Observation>(entries, "Observation");
      const observations = new Map(list.filter((o) => o.id).map((o) => [o.id!, o]));
      return { readings: extractReadings(list), truncated, observations };
    },
    [patientId],
  );
  const ctx: InspectCtx = { enabled, query, patientId, observations: data?.observations ?? new Map() };

  return (
    <section className="card" aria-labelledby="vitals-h">
      <div className="card-header">
        <h2 id="vitals-h">
          Vital signs
          <InspectButton
            enabled={enabled}
            label="the vital signs search"
            target={() => ({
              title: "Vital signs section",
              description:
                "One Observation search for this patient, filtered by the LOINC codes of the vital signs (code=… with commas meaning OR), sorted newest first. Every chart and table row is built from its results.",
              requests: [query],
            })}
          />
          {data && <span className="sub">{data.readings.length} readings</span>}
        </h2>
        <Segmented<View>
          label="Vitals view"
          value={view}
          onChange={setView}
          options={[
            { value: "chart", label: "Chart" },
            { value: "table", label: "Table" },
          ]}
        />
      </div>
      {loading ? (
        <Loading label="Loading vital signs…" />
      ) : error ? (
        <ErrorBanner title="Could not load vital signs" message={error} onRetry={reload} />
      ) : !data || data.readings.length === 0 ? (
        <Empty>No vital signs recorded for this patient.</Empty>
      ) : (
        <>
          {data.truncated && (
            <p className="muted small">Showing the most recent readings only: this patient has a very large number of observations, and the oldest were not loaded.</p>
          )}
          {view === "chart" ? <VitalsCharts readings={data.readings} ctx={ctx} /> : <VitalsTable readings={data.readings} ctx={ctx} />}
        </>
      )}
    </section>
  );
}

function VitalsCharts({ readings, ctx }: { readings: VitalReading[]; ctx: InspectCtx }) {
  return (
    <div className="charts">
      {VITALS.map((v) => (
        <VitalChart key={v.key} def={v} readings={readings} ctx={ctx} />
      ))}
    </div>
  );
}

function VitalChart({ def, readings, ctx }: { def: VitalDef; readings: VitalReading[]; ctx: InspectCtx }) {
  const unit = unitFor(readings, def.key);
  const rows = useMemo(() => chartRows(readings, def.key, unit), [readings, def.key, unit]);
  // Readings in a unit that can't be converted are left off the chart rather than drawn on the
  // wrong scale; the table still lists them.
  const otherUnits = readings.filter((r) => r.vital === def.key && r.unit !== unit).length;
  const multi = def.series.length > 1;
  const last = rows[rows.length - 1];

  const latest = last
    ? def.series
        .map((s) => last[s.key])
        .filter((x) => x !== undefined)
        .map(fmt)
        .join("/")
    : "";

  const target = (): InspectTarget => {
    const mine = readings.filter((r) => r.vital === def.key);
    const obs = observationsFor(mine, ctx.observations);
    return {
      title: `${def.label} chart`,
      description: obs.length
        ? `${mine.length} reading(s) from ${obs.length} Observation resource(s). ${
            multi
              ? "Blood pressure is one Observation with two components: systolic (8480-6) and diastolic (8462-4)."
              : "Each point is one Observation: effectiveDateTime on the x-axis, valueQuantity.value on the y-axis."
          }`
        : "No Observation with these codes came back from the search, so the chart is empty.",
      requests: [ctx.query],
      resources: obs,
      highlight: multi
        ? ["code.coding[*].code", "component[*].code.coding[*].code", "component[*].valueQuantity", "effectiveDateTime"]
        : ["code.coding[*].code", "valueQuantity", "effectiveDateTime"],
      emptyVital: rows.length === 0 ? { patientId: ctx.patientId, label: def.label, codes: codesFor(def) } : undefined,
    };
  };

  return (
    <div className={`chart-card${multi ? " wide" : ""}`} {...inspectable(ctx.enabled, target)}>
      <div className="chart-title">
        <h3>
          {def.label}
          {unit && <span className="muted small"> ({unit})</span>}
          {ctx.enabled && codesFor(def).filter((c) => !def.series.some((s) => s.codes.includes(c)) || !multi).map((c) => (
            <CodeChip key={c} system="http://loinc.org" code={c} />
          ))}
          <InspectButton enabled={ctx.enabled} target={target} label={`${def.label} chart`} />
        </h3>
        {last && (
          <span className="latest">
            Latest <b>{latest}</b> · {shortDate(last.time)}
          </span>
        )}
      </div>
      {multi && (
        <div className="legend" aria-hidden>
          {def.series.map((s, i) => (
            <span key={s.key}>
              <i style={{ background: SERIES_COLORS[i] }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      {otherUnits > 0 && (
        <p className="muted small">
          {otherUnits} reading{otherUnits === 1 ? " is" : "s are"} in a different unit and shown in the table only.
        </p>
      )}
      {rows.length === 0 ? (
        <div className="chart-empty">No readings</div>
      ) : (
        <div style={{ width: "100%", height: 190 }} role="img" aria-label={`${def.label} over time, ${rows.length} readings. Use the table view for exact values.`}>
          <ResponsiveContainer>
            <LineChart data={rows} margin={{ top: 10, right: 12, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="#eef0f3" vertical={false} />
              <XAxis
                dataKey="time"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={shortDate}
                tick={{ fontSize: 11, fill: "#666666" }}
                tickLine={false}
                axisLine={{ stroke: "#d6dae0" }}
                minTickGap={28}
                padding={{ left: 10, right: 10 }}
              />
              <YAxis
                domain={["auto", "auto"]}
                tick={{ fontSize: 11, fill: "#666666" }}
                tickLine={false}
                axisLine={false}
                width={44}
                tickFormatter={fmt}
              />
              <Tooltip
                cursor={{ stroke: "#9aa3ad", strokeDasharray: "3 3" }}
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <div className="tooltip">
                      <div className="t-date">{formatDateTime(new Date(Number(label)).toISOString())}</div>
                      {payload.map((p) => (
                        <div className="t-row" key={String(p.dataKey)}>
                          <i style={{ background: p.color }} />
                          {multi ? `${def.series.find((s) => s.key === p.dataKey)?.label}: ` : ""}
                          <b>{fmt(Number(p.value))}</b> {unit}
                        </div>
                      ))}
                    </div>
                  ) : null
                }
              />
              {def.series.map((s, i) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={SERIES_COLORS[i]}
                  strokeWidth={2}
                  dot={rows.length <= 30 ? { r: 3, strokeWidth: 0, fill: SERIES_COLORS[i] } : false}
                  activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function VitalsTable({ readings, ctx }: { readings: VitalReading[]; ctx: InspectCtx }) {
  const [filter, setFilter] = useState("all");
  const rows = useMemo(() => {
    // Blood pressure: one row per reading with "systolic/diastolic".
    const out: { key: string; time: number; date: string; vital: string; value: string; unit: string; ids: string[]; bp: boolean }[] = [];
    const bp = new Map<string, { time: number; date: string; sys?: number; dia?: number; unit: string; ids: Set<string> }>();
    for (const r of readings) {
      if (filter !== "all" && r.vital !== filter) continue;
      if (r.vital === "bp") {
        // Group by time only: BP may be one panel Observation with two components, or separate
        // systolic and diastolic Observations (different ids) taken at the same moment.
        const k = String(r.time);
        const e = bp.get(k) ?? { time: r.time, date: r.date, unit: r.unit, ids: new Set<string>() };
        if (r.observationId) e.ids.add(r.observationId);
        if (r.series === "systolic") e.sys = r.value;
        else e.dia = r.value;
        bp.set(k, e);
      } else {
        const label = VITALS.find((v) => v.key === r.vital)?.label ?? r.label;
        out.push({
          key: `${r.observationId}|${r.vital}|${r.time}|${out.length}`,
          time: r.time,
          date: r.date,
          vital: label,
          value: fmt(r.value),
          unit: r.unit,
          ids: r.observationId ? [r.observationId] : [],
          bp: false,
        });
      }
    }
    for (const [k, e] of bp) {
      out.push({
        key: `bp|${k}`,
        time: e.time,
        date: e.date,
        vital: "Blood pressure",
        value: `${e.sys !== undefined ? fmt(e.sys) : "?"}/${e.dia !== undefined ? fmt(e.dia) : "?"}`,
        unit: e.unit,
        ids: [...e.ids],
        bp: true,
      });
    }
    return out.sort((a, b) => b.time - a.time || a.vital.localeCompare(b.vital));
  }, [readings, filter]);

  return (
    <>
      <div className="toolbar" style={{ marginBottom: "0.75rem" }}>
        <label className="small muted" htmlFor="vital-filter">
          Show
        </label>
        <select id="vital-filter" className="select" style={{ width: "auto" }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All vital signs</option>
          {VITALS.map((v) => (
            <option key={v.key} value={v.key}>
              {v.label}
            </option>
          ))}
        </select>
        <span className="small muted">{rows.length} readings</span>
      </div>
      {rows.length === 0 ? (
        <Empty>No readings for this vital sign.</Empty>
      ) : (
        <div className="table-wrap scroll-md">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Vital sign</th>
                <th>Value</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const target = (): InspectTarget => ({
                  title: `${r.vital}: ${r.value} ${r.unit}`,
                  description: r.bp
                    ? "Blood pressure: systolic and diastolic come from the components of the Observation (or from two Observations taken at the same time)."
                    : "One Observation: the value is valueQuantity.value, the unit valueQuantity.unit, the date effectiveDateTime.",
                  requests: [ctx.query],
                  resources: r.ids.map((id) => ctx.observations.get(id)).filter((o): o is Observation => !!o),
                  highlight: r.bp
                    ? ["component[*].valueQuantity", "effectiveDateTime"]
                    : ["valueQuantity", "effectiveDateTime"],
                });
                return (
                <tr key={r.key} {...inspectable(ctx.enabled, target)}>
                  <td className="num">{formatDateTime(r.date)}</td>
                  <td>
                    {r.vital}
                    <InspectButton enabled={ctx.enabled} target={target} label={`${r.vital} on ${formatDateTime(r.date)}`} />
                  </td>
                  <td className="num">
                    <b>{r.value}</b>
                  </td>
                  <td className="muted">{r.unit}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
