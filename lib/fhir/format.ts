/** Helpers that turn FHIR data into display strings. Pure functions, unit-tested. */
import type {
  CodeableConcept,
  Condition,
  Dosage,
  HumanName,
  Patient,
  Quantity,
  Timing,
} from "./types";

export const DASH = "—";

/** The name to show: the "official" or "usual" name if present, else the first one. */
export function primaryName(p: Pick<Patient, "name">): HumanName | undefined {
  const names = p.name ?? [];
  return names.find((n) => n.use === "official") ?? names.find((n) => n.use === "usual") ?? names[0];
}

/** "First Middle Family". Falls back to name.text. */
export function formatName(p: Pick<Patient, "name">): string {
  const n = primaryName(p);
  if (!n) return "(no name)";
  const parts = [...(n.given ?? []), n.family].filter((s): s is string => !!s && !!s.trim());
  const s = parts.length ? parts.join(" ") : n.text ?? "";
  return s.trim() || "(no name)";
}

export function formatGender(g?: string): string {
  if (!g) return DASH;
  return g.charAt(0).toUpperCase() + g.slice(1);
}

/**
 * Formats a FHIR date / dateTime for display, keeping its precision:
 * "1980" -> "1980", "1980-04" -> "Apr 1980", "1980-04-12" -> "12 Apr 1980".
 * Plain dates are not converted through the local timezone (that would shift the day).
 */
export function formatDate(value?: string): string {
  if (!value) return DASH;
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(value);
  if (!m) return value;
  const [, y, mo, d] = m;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (!mo) return y;
  const mon = months[Number(mo) - 1] ?? mo;
  if (!d) return `${mon} ${y}`;
  return `${Number(d)} ${mon} ${y}`;
}

/** Date plus time (local) for dateTimes that have a time part. */
export function formatDateTime(value?: string): string {
  if (!value) return DASH;
  if (!value.includes("T")) return formatDate(value);
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** text -> first coding.display -> first coding.code. */
export function codeText(cc?: CodeableConcept): string {
  if (!cc) return DASH;
  return cc.text || cc.coding?.find((c) => c.display)?.display || cc.coding?.find((c) => c.code)?.code || DASH;
}

const SYSTEM_LABELS: Record<string, string> = {
  "http://snomed.info/sct": "SNOMED",
  "http://loinc.org": "LOINC",
  "http://hl7.org/fhir/sid/icd-10": "ICD-10",
  "http://hl7.org/fhir/sid/icd-10-cm": "ICD-10-CM",
  "http://www.nlm.nih.gov/research/umls/rxnorm": "RxNorm",
};

/** "SNOMED 44054006" (first coding that has a code). */
export function codeLabel(cc?: CodeableConcept): string {
  const c = cc?.coding?.find((x) => x.code);
  if (!c?.code) return DASH;
  const sys = c.system ? SYSTEM_LABELS[c.system] ?? "" : "";
  return sys ? `${sys} ${c.code}` : c.code;
}

export function formatQuantity(q?: Quantity): string {
  if (q?.value === undefined || q.value === null) return DASH;
  // Shown exactly as recorded: rounding would turn a 0.125 mg dose into a 0.13 mg one.
  const v = String(q.value);
  const unit = q.unit ?? q.code;
  return unit ? `${v} ${unit}` : v;
}

export function conditionOnset(c: Condition): string {
  if (c.onsetDateTime) return formatDate(c.onsetDateTime);
  if (c.onsetPeriod?.start) return formatDate(c.onsetPeriod.start);
  if (c.onsetString) return c.onsetString;
  if (c.onsetAge?.value !== undefined) return `Age ${formatQuantity(c.onsetAge)}`;
  if (c.onsetRange?.low?.value !== undefined) return `Age ${formatQuantity(c.onsetRange.low)}+`;
  return DASH;
}

/** Sortable key for onset (ISO date string or ""). */
export function conditionOnsetKey(c: Condition): string {
  return c.onsetDateTime ?? c.onsetPeriod?.start ?? c.recordedDate ?? "";
}

/** The clinicalStatus code: active | recurrence | relapse | inactive | remission | resolved | "". */
export function clinicalStatusCode(c: Condition): string {
  return (
    c.clinicalStatus?.coding?.find((x) => x.code)?.code ?? c.clinicalStatus?.text?.toLowerCase() ?? ""
  );
}

/** FHIR treats recurrence and relapse as sub-types of "active". */
/** Condition.verificationStatus code: confirmed, provisional, differential, unconfirmed, refuted, entered-in-error, or "". */
export function verificationStatusCode(c: Condition): string {
  return (
    c.verificationStatus?.coding?.find((x) => x.code)?.code ?? c.verificationStatus?.text?.toLowerCase() ?? ""
  );
}

/** True if any coding marks the Condition as recorded by mistake. */
export function isEnteredInError(c: Condition): boolean {
  return (c.verificationStatus?.coding ?? []).some((x) => x.code === "entered-in-error");
}

/** Active clinical status, and not ruled out: a refuted diagnosis is not an active condition. */
export function isConditionActive(c: Condition): boolean {
  return ["active", "recurrence", "relapse"].includes(clinicalStatusCode(c)) && verificationStatusCode(c) !== "refuted";
}

export function capitalize(s?: string): string {
  if (!s) return DASH;
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " ");
}

// ---- Medication dosage ----

export function formatDose(d?: Dosage): string {
  const dr = d?.doseAndRate?.[0];
  if (dr?.doseQuantity) return formatQuantity(dr.doseQuantity);
  if (dr?.doseRange?.low || dr?.doseRange?.high) {
    const lo = dr.doseRange.low?.value;
    const hi = dr.doseRange.high?.value;
    const unit = dr.doseRange.high?.unit ?? dr.doseRange.low?.unit ?? "";
    return `${lo ?? "?"}–${hi ?? "?"}${unit ? ` ${unit}` : ""}`;
  }
  return DASH;
}

const PERIOD_UNITS: Record<string, [string, string]> = {
  s: ["second", "seconds"],
  min: ["minute", "minutes"],
  h: ["hour", "hours"],
  d: ["day", "days"],
  wk: ["week", "weeks"],
  mo: ["month", "months"],
  a: ["year", "years"],
};

export function formatTiming(t?: Timing): string {
  if (!t) return "";
  if (t.code) return codeText(t.code);
  const r = t.repeat;
  if (!r) return "";
  const parts: string[] = [];
  if (r.frequency !== undefined && r.period !== undefined && r.periodUnit) {
    const freq = r.frequencyMax ? `${r.frequency}–${r.frequencyMax}` : String(r.frequency);
    const [one, many] = PERIOD_UNITS[r.periodUnit] ?? [r.periodUnit, r.periodUnit];
    const per = r.period === 1 ? one : `${r.period} ${many}`;
    const times =
      freq === "1" ? "once" : freq === "2" ? "twice" : `${freq} times`;
    if (freq === "1" && r.period === 1 && r.periodUnit === "d") parts.push("Once daily");
    else if (freq === "1" && r.period !== 1) parts.push(`Every ${per}`);
    else parts.push(`${capitalize(times)} per ${per}`);
  }
  if (r.when?.length) parts.push(r.when.join(", "));
  if (r.timeOfDay?.length) parts.push(`at ${r.timeOfDay.map((x) => x.slice(0, 5)).join(", ")}`);
  return parts.join(" ");
}

export function formatFrequency(d?: Dosage): string {
  if (!d) return DASH;
  const timing = formatTiming(d.timing);
  const asNeeded = d.asNeededBoolean
    ? "as needed"
    : d.asNeededCodeableConcept
      ? `as needed for ${codeText(d.asNeededCodeableConcept)}`
      : "";
  const s = [timing, asNeeded].filter(Boolean).join(", ");
  if (s) return s.charAt(0).toUpperCase() + s.slice(1);
  return d.text || DASH;
}

export function formatRoute(d?: Dosage): string {
  return d?.route ? codeText(d.route) : DASH;
}
