/**
 * Resolving medication names. A MedicationRequest names its drug either inline
 * (medicationCodeableConcept) or by reference to a Medication resource (medicationReference),
 * which may be contained in the request, _include'd in the search Bundle, or need a separate GET.
 */
import { codeText, DASH } from "./format";
import type { Bundle, Medication, MedicationRequest } from "./types";

/** "Medication/123" or an absolute URL ending in Medication/123 -> "Medication/123". */
export function normalizeRef(ref: string): string {
  const m = /(?:^|\/)(Medication\/[^/?#]+)(?:\/_history\/[^/?#]+)?$/.exec(ref);
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
export function unresolvedRefs(requests: MedicationRequest[], known: Map<string, Medication>): string[] {
  const out = new Set<string>();
  for (const r of requests) {
    if (r.medicationCodeableConcept) continue;
    const ref = r.medicationReference?.reference;
    if (!ref || ref.startsWith("#")) continue;
    const key = normalizeRef(ref);
    if (key.startsWith("Medication/") && !known.has(key)) out.add(key);
  }
  return [...out];
}

export function medicationName(r: MedicationRequest, known: Map<string, Medication>): string {
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
      const med = known.get(normalizeRef(ref.reference));
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
