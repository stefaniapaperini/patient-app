/** Vital-sign definitions (LOINC) and grouping of Observations into time series. */
import type { Observation, Quantity } from "./types";

export interface VitalSeriesDef {
  key: string;
  label: string;
  /** LOINC codes for this line. */
  codes: string[];
}

export interface VitalDef {
  key: string;
  label: string;
  /** One line for most vitals, two for blood pressure. */
  series: VitalSeriesDef[];
}

/** Validated categorical slots (dataviz reference palette): blue, then orange. */
export const SERIES_COLORS = ["#257de0", "#f47230"];

export const SYSTOLIC = "8480-6";
export const DIASTOLIC = "8462-4";
/** Blood pressure panel. 55284-4 is the code from the spec; 85354-9 is the one Synthea/US Core use. */
export const BP_PANELS = ["55284-4", "85354-9"];

export const VITALS: VitalDef[] = [
  {
    key: "bp",
    label: "Blood pressure",
    series: [
      { key: "systolic", label: "Systolic", codes: [SYSTOLIC] },
      { key: "diastolic", label: "Diastolic", codes: [DIASTOLIC] },
    ],
      },
  { key: "hr", label: "Heart rate", series: [{ key: "value", label: "Heart rate", codes: ["8867-4"] }] },
  { key: "temp", label: "Temperature", series: [{ key: "value", label: "Temperature", codes: ["8310-5"] }] },
  { key: "rr", label: "Respiratory rate", series: [{ key: "value", label: "Respiratory rate", codes: ["9279-1"] }] },
  { key: "spo2", label: "Oxygen saturation", series: [{ key: "value", label: "SpO₂", codes: ["59408-5"] }] },
  { key: "height", label: "Height", series: [{ key: "value", label: "Height", codes: ["8302-2"] }] },
  { key: "weight", label: "Weight", series: [{ key: "value", label: "Weight", codes: ["29463-7"] }] },
  { key: "bmi", label: "BMI", series: [{ key: "value", label: "BMI", codes: ["39156-5"] }] },
];

/** The codes in the Observation query: the spec's list plus the Synthea/US Core BP panel and
 * standalone systolic/diastolic, so blood pressure shows however the server stores it. */
export const VITALS_QUERY_CODES = [
  "8867-4", "8310-5", "9279-1", "59408-5", "8302-2", "29463-7", "39156-5", "55284-4",
  "85354-9", SYSTOLIC, DIASTOLIC,
];

export function vitalsQuery(patientId: string): string {
  const p = new URLSearchParams({
    subject: `Patient/${patientId}`,
    code: VITALS_QUERY_CODES.join(","),
    _sort: "date",
    _count: "200",
  });
  return `Observation?${p.toString()}`;
}

/** One reading of one series. */
export interface VitalReading {
  vital: string; // VitalDef.key
  series: string; // VitalSeriesDef.key
  label: string; // human label of the series
  time: number; // epoch ms
  date: string; // original FHIR dateTime
  value: number;
  unit: string;
  observationId?: string;
}

function hasLoinc(codes: { coding?: { system?: string; code?: string }[] } | undefined, code: string) {
  return !!codes?.coding?.some((c) => c.code === code && (!c.system || c.system === "http://loinc.org"));
}

function effectiveDate(o: Observation): string | undefined {
  return o.effectiveDateTime ?? o.effectivePeriod?.start ?? o.effectiveInstant ?? o.issued;
}

function push(out: VitalReading[], o: Observation, date: string, q: Quantity | undefined, code: string) {
  if (q?.value === undefined || q.value === null || !Number.isFinite(q.value)) return;
  const time = Date.parse(date);
  if (isNaN(time)) return;
  for (const v of VITALS) {
    for (const s of v.series) {
      if (s.codes.includes(code)) {
        out.push({
          vital: v.key,
          series: s.key,
          label: v.series.length > 1 ? s.label : v.label,
          time,
          date,
          value: q.value,
          unit: q.unit ?? q.code ?? "",
          observationId: o.id,
        });
      }
    }
  }
}

/** Flattens Observations (including BP panel components) into readings sorted by time. */
export function extractReadings(observations: Observation[]): VitalReading[] {
  const out: VitalReading[] = [];
  const allCodes = VITALS.flatMap((v) => v.series.flatMap((s) => s.codes));
  for (const o of observations) {
    if (o.status === "entered-in-error" || o.status === "cancelled") continue;
    const date = effectiveDate(o);
    if (!date) continue;
    const code = allCodes.find((c) => hasLoinc(o.code, c));
    if (code) push(out, o, date, o.valueQuantity, code);
    for (const comp of o.component ?? []) {
      const cc = allCodes.find((c) => hasLoinc(comp.code, c));
      if (cc) push(out, o, date, comp.valueQuantity, cc);
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Chart rows for one vital: [{ time, systolic, diastolic }, ...] merged by timestamp. */
export function chartRows(readings: VitalReading[], vitalKey: string): Record<string, number>[] {
  const byTime = new Map<number, Record<string, number>>();
  for (const r of readings) {
    if (r.vital !== vitalKey) continue;
    const row = byTime.get(r.time) ?? { time: r.time };
    row[r.series] = r.value;
    byTime.set(r.time, row);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export function unitFor(readings: VitalReading[], vitalKey: string): string {
  return readings.find((r) => r.vital === vitalKey && r.unit)?.unit ?? "";
}
