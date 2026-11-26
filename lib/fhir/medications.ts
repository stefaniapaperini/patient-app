/**
 * Resolving medication names. A MedicationRequest names its drug either inline
 * (medicationCodeableConcept) or by reference to a Medication resource (medicationReference),
 * which may be contained in the request, _include'd in the search Bundle, or need a separate GET.
 */
import { codeText, DASH } from "./format";
import type { Bundle, Medication, MedicationRequest } from "./types";

/**
 * The FHIR server's base URL as it names itself in search results: entry.fullUrl is
 * "{base}/{type}/{id}". Undefined if no entry has a fullUrl of that shape.
 */
export function serverBase(entries: NonNullable<Bundle["entry"]>): string | undefined {
  for (const e of entries) {
    const r = e.resource;
    if (!e.fullUrl || !r?.id) continue;
    const tail = `/${r.resourceType}/${r.id}`;
    if (e.fullUrl.endsWith(tail)) return e.fullUrl.slice(0, -tail.length);
  }
  return undefined;
}

/**
 * "Medication/123" or "/Medication/123" (optionally with /_history/v) -> "Medication/123".
 * An absolute URL is shortened the same way only when it starts with this server's base as its
 * search results name it (`base`, from entry.fullUrl). Anything else is returned unchanged and is
 * never looked up here: matching on the path alone would send https://other.org/fhir/Medication/42
 * to this server's Medication/42, which may be a different drug. Such a reference shows its
 * `display` instead.
 */
export function normalizeRef(ref: string, base?: string): string {
  let rel = ref;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) {
    const b = base?.replace(/\/+$/, "");
    if (!b || !ref.startsWith(b + "/")) return ref;
    rel = ref.slice(b.length + 1);
  } else {
    rel = ref.replace(/^\/+/, "");
  }
  const m = /^(Medication\/[^/?#]+)(?:\/_history\/[^/?#]+)?$/.exec(rel);
  return m ? m[1] : ref;
}

/** Builds a lookup "Medication/id" -> Medication from Bundle entries (_include results). */
export function includedMedications(entries: NonNullable<Bundle["entry"]>): Map<string, Medication> {
  const map = new Map<string, Medication>();
  for (const e of entries) {
    const r = e.resource;
    if (r?.resourceType === "Medication" && r.id) map.set(`Medication/${r.id}`, r as Medication);
  }
  return map;
}

/** References that are neither contained nor already in `known`: these need a separate GET. */
export function unresolvedRefs(requests: MedicationRequest[], known: Map<string, Medication>, base?: string): string[] {
  const out = new Set<string>();
  for (const r of requests) {
    if (r.medicationCodeableConcept) continue;
    const ref = r.medicationReference?.reference;
    if (!ref || ref.startsWith("#")) continue;
    const key = normalizeRef(ref, base);
    if (key.startsWith("Medication/") && !known.has(key)) out.add(key);
  }
  return [...out];
}

export function medicationName(r: MedicationRequest, known: Map<string, Medication>, base?: string): string {
  if (r.medicationCodeableConcept) return codeText(r.medicationCodeableConcept);
  const ref = r.medicationReference;
  if (ref?.reference) {
    if (ref.reference.startsWith("#")) {
      const id = ref.reference.slice(1);
      const contained = r.contained?.find((c) => c.resourceType === "Medication" && c.id === id) as
        | Medication
        | undefined;
      if (contained?.code) return codeText(contained.code);
    } else {
      const med = known.get(normalizeRef(ref.reference, base));
      if (med?.code) return codeText(med.code);
    }
  }
  if (ref?.display) return ref.display;
  return ref ? "Unknown medication" : DASH;
}

/** "Current" = still in effect or about to be. */
export function isMedicationActive(r: MedicationRequest): boolean {
  return ["active", "on-hold", "draft"].includes(r.status ?? "");
}
