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
    // Newest first: if a long history hits the page cap, the oldest readings are the ones left out.
    _sort: "-date",
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

/**
 * Epoch ms for a FHIR date/dateTime. Date-only values ("2024-03-10", "2024-03", "2024") are read
 * as *local* midnight: Date.parse would read them as UTC midnight, which shows as the previous day
 * in time zones behind UTC. Values with a time part keep their own offset.
 */
export function fhirTime(date: string): number {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(date);
  if (m) return new Date(Number(m[1]), Number(m[2] ?? 1) - 1, Number(m[3] ?? 1)).getTime();
  return Date.parse(date);
}

/** Units converted to one unit per vital, so a chart never mixes kg and lb on one axis. */
const CONVERSIONS: Record<string, { unit: string; convert: (v: number) => number }> = {
  "[lb_av]": { unit: "kg", convert: (v) => v * 0.45359237 },
  lb: { unit: "kg", convert: (v) => v * 0.45359237 },
  lbs: { unit: "kg", convert: (v) => v * 0.45359237 },
  g: { unit: "kg", convert: (v) => v / 1000 },
  "[in_i]": { unit: "cm", convert: (v) => v * 2.54 },
  in: { unit: "cm", convert: (v) => v * 2.54 },
  m: { unit: "cm", convert: (v) => v * 100 },
  "[degF]": { unit: "Cel", convert: (v) => ((v - 32) * 5) / 9 },
  degF: { unit: "Cel", convert: (v) => ((v - 32) * 5) / 9 },
  "°F": { unit: "Cel", convert: (v) => ((v - 32) * 5) / 9 },
};

/** Value and unit, converted to the metric unit when the reading is in pounds, inches or °F. */
export function normalizeQuantity(q: Quantity): { value: number; unit: string } {
  const unit = q.unit ?? q.code ?? "";
  const conv = CONVERSIONS[q.code ?? ""] ?? CONVERSIONS[q.unit ?? ""];
  return conv ? { value: conv.convert(q.value!), unit: conv.unit } : { value: q.value!, unit };
}

function push(out: VitalReading[], o: Observation, date: string, q: Quantity | undefined, code: string) {
  if (q?.value === undefined || q.value === null || !Number.isFinite(q.value)) return;
  const time = fhirTime(date);
  if (isNaN(time)) return;
  const { value, unit } = normalizeQuantity(q);
  for (const v of VITALS) {
    for (const s of v.series) {
      if (s.codes.includes(code)) {
        out.push({
          vital: v.key,
          series: s.key,
          label: v.series.length > 1 ? s.label : v.label,
          time,
          date,
          value,
          unit,
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

/** One measurement of a vital: e.g. one blood pressure (systolic + diastolic). */
export interface Measurement {
  time: number;
  date: string;
  unit: string;
  /** series key -> value */
  values: Record<string, number>;
  observationIds: string[];
}

/**
 * Groups one vital's readings into measurements without ever overwriting or mixing values:
 * 1. Readings of the same Observation at the same time form one measurement (a BP panel's
 *    systolic and diastolic components).
 * 2. Separate single-series Observations at the same time and unit (a standalone systolic and a
 *    standalone diastolic) are paired only when the pairing is unambiguous: each series occurs
 *    once at that moment. Otherwise each stays its own measurement.
 * Two measurements at the same time therefore stay two rows, not one row with the last value.
 */
export function groupMeasurements(readings: VitalReading[], vitalKey: string, unit?: string): Measurement[] {
  const groups: Measurement[] = [];
  const byObs = new Map<string, Measurement>();
  for (const r of readings) {
    if (r.vital !== vitalKey) continue;
    if (unit !== undefined && r.unit !== unit) continue;
    const key = r.observationId !== undefined ? `${r.observationId}|${r.time}|${r.unit}` : undefined;
    let g = key !== undefined ? byObs.get(key) : undefined;
    if (!g || r.series in g.values) {
      g = { time: r.time, date: r.date, unit: r.unit, values: {}, observationIds: r.observationId ? [r.observationId] : [] };
      groups.push(g);
      if (key !== undefined) byObs.set(key, g);
    }
    g.values[r.series] = r.value;
  }

  const singles = new Map<string, Measurement[]>();
  for (const g of groups) {
    if (Object.keys(g.values).length !== 1) continue;
    const k = `${g.time}|${g.unit}`;
    singles.set(k, [...(singles.get(k) ?? []), g]);
  }
  const merged = new Set<Measurement>();
  for (const list of singles.values()) {
    if (list.length < 2) continue;
    const series = list.map((g) => Object.keys(g.values)[0]);
    if (new Set(series).size !== series.length) continue; // ambiguous: leave them apart
    const [first, ...rest] = list;
    for (const g of rest) {
      Object.assign(first.values, g.values);
      first.observationIds.push(...g.observationIds);
      merged.add(g);
    }
  }
  return groups.filter((g) => !merged.has(g)).sort((a, b) => a.time - b.time);
}

/**
 * Chart rows for one vital: [{ time, systolic, diastolic }, ...], one per measurement (see
 * groupMeasurements). With `unit`, only readings in that unit are included (one y-axis, one unit).
 */
export function chartRows(readings: VitalReading[], vitalKey: string, unit?: string): Record<string, number>[] {
  return groupMeasurements(readings, vitalKey, unit).map((m) => ({ time: m.time, ...m.values }));
}

/** The unit most readings of a vital use (after conversion); the chart is drawn in this unit. */
export function unitFor(readings: VitalReading[], vitalKey: string): string {
  const counts = new Map<string, number>();
  for (const r of readings) if (r.vital === vitalKey) counts.set(r.unit, (counts.get(r.unit) ?? 0) + 1);
  let best = "";
  let n = 0;
  for (const [u, c] of counts) if (c > n || (c === n && !best && u)) [best, n] = [u, c];
  return best;
}
