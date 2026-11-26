"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Empty, ErrorBanner, Loading, Segmented } from "./ui";
import { fetchAllPages, matches } from "@/lib/fhir/client";
import { formatDateTime } from "@/lib/fhir/format";
import type { Observation } from "@/lib/fhir/types";
import {
  chartRows,
  extractReadings,
  SERIES_COLORS,
  unitFor,
  VITALS,
  vitalsQuery,
  type VitalDef,
  type VitalReading,
} from "@/lib/fhir/vitals";
import { useAsync } from "@/lib/useAsync";

type View = "chart" | "table";

const shortDate = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { year: "2-digit", month: "short", day: "numeric" });

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString());

export function VitalsSection({ patientId }: { patientId: string }) {
  const [view, setView] = useState<View>("chart");
  const { data, loading, error, reload } = useAsync(
    async (signal) => {
      const { entries, truncated } = await fetchAllPages<Observation>(vitalsQuery(patientId), { signal });
      return { readings: extractReadings(matches<Observation>(entries, "Observation")), truncated };
    },
    [patientId],
  );

  return (
    <section className="card" aria-labelledby="vitals-h">
      <div className="card-header">
        <h2 id="vitals-h">
          Vital signs
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
            <p className="muted small">Showing the first readings only: this patient has a very large number of observations.</p>
          )}
          {view === "chart" ? <VitalsCharts readings={data.readings} /> : <VitalsTable readings={data.readings} />}
        </>
      )}
    </section>
  );
}

function VitalsCharts({ readings }: { readings: VitalReading[] }) {
  return (
    <div className="charts">
      {VITALS.map((v) => (
        <VitalChart key={v.key} def={v} readings={readings} />
      ))}
    </div>
  );
}

function VitalChart({ def, readings }: { def: VitalDef; readings: VitalReading[] }) {
  const rows = useMemo(() => chartRows(readings, def.key), [readings, def.key]);
  const unit = unitFor(readings, def.key);
  const multi = def.series.length > 1;
  const last = rows[rows.length - 1];

  const latest = last
    ? def.series
        .map((s) => last[s.key])
        .filter((x) => x !== undefined)
        .map(fmt)
        .join("/")
    : "";

  return (
    <div className={`chart-card${multi ? " wide" : ""}`}>
      <div className="chart-title">
        <h3>
          {def.label}
          {unit && <span className="muted small"> ({unit})</span>}
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

function VitalsTable({ readings }: { readings: VitalReading[] }) {
  const [filter, setFilter] = useState("all");
  const rows = useMemo(() => {
    // Blood pressure: one row per reading with "systolic/diastolic".
    const out: { key: string; time: number; date: string; vital: string; value: string; unit: string }[] = [];
    const bp = new Map<string, { time: number; date: string; sys?: number; dia?: number; unit: string }>();
    for (const r of readings) {
      if (filter !== "all" && r.vital !== filter) continue;
      if (r.vital === "bp") {
        const k = `${r.observationId ?? ""}|${r.time}`;
        const e = bp.get(k) ?? { time: r.time, date: r.date, unit: r.unit };
        if (r.series === "systolic") e.sys = r.value;
        else e.dia = r.value;
        bp.set(k, e);
      } else {
        const label = VITALS.find((v) => v.key === r.vital)?.label ?? r.label;
        out.push({ key: `${r.observationId}|${r.vital}|${r.time}|${out.length}`, time: r.time, date: r.date, vital: label, value: fmt(r.value), unit: r.unit });
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
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="num">{formatDateTime(r.date)}</td>
                  <td>{r.vital}</td>
                  <td className="num">
                    <b>{r.value}</b>
                  </td>
                  <td className="muted">{r.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
