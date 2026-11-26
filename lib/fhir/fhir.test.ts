import { describe, expect, it } from "vitest";
import {
  codeLabel,
  codeText,
  conditionOnset,
  formatDate,
  formatFrequency,
  formatName,
  isConditionActive,
} from "./format";
import { buildNewPatient, buildUpdatedPatient, patientToForm, validatePatient, type PatientFormValues } from "./patient";
import { chartRows, extractReadings, vitalsQuery } from "./vitals";
import { includedMedications, medicationName, normalizeRef, unresolvedRefs } from "./medications";
import { outcomeMessage } from "./client";
import { buildUpstreamUrl, rewriteBundleLinks, toProxyUrl } from "../server/proxy";
import type { Condition, MedicationRequest, Observation, Patient } from "./types";

const NOW = new Date("2026-11-26T12:00:00");
const valid: PatientFormValues = { given: "Mary Ann", family: "O'Brien-Smith", gender: "female", birthDate: "1980-04-12", phone: "+44 20 7946 0000" };

describe("validatePatient", () => {
  it("accepts a valid patient", () => {
    expect(validatePatient(valid, NOW)).toEqual({});
  });
  it("requires every mandatory field", () => {
    const e = validatePatient({ given: " ", family: "", gender: "", birthDate: "", phone: "" }, NOW);
    expect(Object.keys(e).sort()).toEqual(["birthDate", "family", "gender", "given"]);
  });
  it("rejects a birth date in the future", () => {
    expect(validatePatient({ ...valid, birthDate: "2026-11-27" }, NOW).birthDate).toMatch(/future/);
    expect(validatePatient({ ...valid, birthDate: "2026-11-26" }, NOW).birthDate).toBeUndefined();
  });
  it("rejects impossible dates and bad formats", () => {
    expect(validatePatient({ ...valid, birthDate: "2023-02-30" }, NOW).birthDate).toBeDefined();
    expect(validatePatient({ ...valid, birthDate: "12/04/1980" }, NOW).birthDate).toBeDefined();
    expect(validatePatient({ ...valid, birthDate: "1899-12-31" }, NOW).birthDate).toBeDefined();
  });
  it("rejects invalid gender, names with digits and bad phones", () => {
    expect(validatePatient({ ...valid, gender: "x" as never }, NOW).gender).toBeDefined();
    expect(validatePatient({ ...valid, given: "John123" }, NOW).given).toBeDefined();
    expect(validatePatient({ ...valid, phone: "abc" }, NOW).phone).toBeDefined();
    expect(validatePatient({ ...valid, phone: "123" }, NOW).phone).toBeDefined();
  });
});

describe("Patient resources", () => {
  it("builds a FHIR R4 Patient with given[] and family", () => {
    expect(buildNewPatient(valid)).toEqual({
      resourceType: "Patient",
      name: [{ use: "official", given: ["Mary", "Ann"], family: "O'Brien-Smith" }],
      gender: "female",
      birthDate: "1980-04-12",
      telecom: [{ system: "phone", value: "+44 20 7946 0000" }],
    });
  });
  it("omits telecom when phone is empty", () => {
    expect(buildNewPatient({ ...valid, phone: "" }).telecom).toBeUndefined();
  });
  it("keeps fields the form does not edit when updating", () => {
    const original: Patient = {
      resourceType: "Patient",
      id: "p1",
      meta: { versionId: "3" },
      identifier: [{ value: "MRN1" }] as never,
      name: [{ use: "official", given: ["Old"], family: "Name", prefix: ["Mrs."], text: "Mrs. Old Name" }, { use: "maiden", family: "Maid" }],
      gender: "female",
      birthDate: "1970-01-01",
      telecom: [{ system: "email", value: "a@b.c" }, { system: "phone", value: "111111" }],
    };
    const u = buildUpdatedPatient(original, { ...valid, phone: "222222" });
    expect(u.meta).toBeUndefined();
    expect(u.identifier).toEqual([{ value: "MRN1" }]);
    expect(u.name![0]).toEqual({ use: "official", given: ["Mary", "Ann"], family: "O'Brien-Smith", prefix: ["Mrs."] });
    expect(u.name![1]).toEqual({ use: "maiden", family: "Maid" });
    expect(u.telecom).toEqual([{ system: "email", value: "a@b.c" }, { system: "phone", value: "222222" }]);
    expect(u.birthDate).toBe("1980-04-12");
  });
  it("removes the phone when cleared, and round-trips through the form", () => {
    const p = buildNewPatient(valid);
    expect(patientToForm(p)).toEqual(valid);
    expect(buildUpdatedPatient(p, { ...valid, phone: "" }).telecom).toBeUndefined();
  });
});

describe("formatting", () => {
  it("formats names", () => {
    expect(formatName({ name: [{ given: ["A", "B"], family: "C" }] })).toBe("A B C");
    expect(formatName({ name: [{ use: "nickname", given: ["X"] }, { use: "official", given: ["Y"], family: "Z" }] })).toBe("Y Z");
    expect(formatName({ name: [{ text: "Only Text" }] })).toBe("Only Text");
    expect(formatName({})).toBe("(no name)");
  });
  it("formats dates without timezone shifts", () => {
    expect(formatDate("1980-04-01")).toBe("1 Apr 1980");
    expect(formatDate("1980-04")).toBe("Apr 1980");
    expect(formatDate("1980")).toBe("1980");
    expect(formatDate(undefined)).toBe("—");
  });
  it("reads codeable concepts", () => {
    const cc = { coding: [{ system: "http://snomed.info/sct", code: "44054006", display: "Diabetes" }] };
    expect(codeText(cc)).toBe("Diabetes");
    expect(codeText({ ...cc, text: "Type 2 diabetes" })).toBe("Type 2 diabetes");
    expect(codeLabel(cc)).toBe("SNOMED 44054006");
  });
  it("reads condition onset and status", () => {
    const c: Condition = { resourceType: "Condition", onsetPeriod: { start: "2001-02-03" }, clinicalStatus: { coding: [{ code: "relapse" }] } };
    expect(conditionOnset(c)).toBe("3 Feb 2001");
    expect(isConditionActive(c)).toBe(true);
    expect(isConditionActive({ ...c, clinicalStatus: { coding: [{ code: "resolved" }] } })).toBe(false);
    expect(conditionOnset({ resourceType: "Condition", onsetAge: { value: 40, unit: "a" } })).toBe("Age 40 a");
  });
  it("describes frequencies", () => {
    expect(formatFrequency({ timing: { repeat: { frequency: 1, period: 1, periodUnit: "d" } } })).toBe("Once daily");
    expect(formatFrequency({ timing: { repeat: { frequency: 2, period: 1, periodUnit: "d" } } })).toBe("Twice per day");
    expect(formatFrequency({ timing: { repeat: { frequency: 1, period: 8, periodUnit: "h" } } })).toBe("Every 8 hours");
    expect(formatFrequency({ asNeededBoolean: true })).toBe("As needed");
    expect(formatFrequency({ text: "Take with food" })).toBe("Take with food");
  });
});

describe("vitals", () => {
  const loinc = (code: string) => ({ coding: [{ system: "http://loinc.org", code }] });
  const obs: Observation[] = [
    { resourceType: "Observation", id: "1", code: loinc("8867-4"), effectiveDateTime: "2024-01-02T10:00:00Z", valueQuantity: { value: 72, unit: "/min" } },
    {
      resourceType: "Observation", id: "2", code: loinc("85354-9"), effectiveDateTime: "2024-01-02T10:00:00Z",
      component: [
        { code: loinc("8480-6"), valueQuantity: { value: 120, unit: "mm[Hg]" } },
        { code: loinc("8462-4"), valueQuantity: { value: 80, unit: "mm[Hg]" } },
      ],
    },
    { resourceType: "Observation", id: "3", code: loinc("55284-4"), effectivePeriod: { start: "2023-05-01" },
      component: [{ code: loinc("8480-6"), valueQuantity: { value: 130 } }, { code: loinc("8462-4"), valueQuantity: { value: 85 } }] },
    { resourceType: "Observation", id: "4", status: "entered-in-error", code: loinc("8867-4"), effectiveDateTime: "2024-01-03", valueQuantity: { value: 999 } },
  ];
  it("extracts readings, including BP components, sorted by time", () => {
    const r = extractReadings(obs);
    expect(r.map((x) => `${x.vital}:${x.series}:${x.value}`)).toEqual([
      "bp:systolic:130", "bp:diastolic:85", "hr:value:72", "bp:systolic:120", "bp:diastolic:80",
    ]);
  });
  it("merges BP series into chart rows by timestamp", () => {
    const rows = chartRows(extractReadings(obs), "bp");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ systolic: 120, diastolic: 80 });
  });
  it("queries the codes from the spec", () => {
    const q = decodeURIComponent(vitalsQuery("abc"));
    expect(q).toContain("subject=Patient/abc");
    expect(q).toContain("8867-4,8310-5,9279-1,59408-5,8302-2,29463-7,39156-5,55284-4");
  });
});

describe("medications", () => {
  const known = includedMedications([
    { resource: { resourceType: "Medication", id: "m1", code: { text: "Metformin 500 mg" } } as never, search: { mode: "include" } },
  ]);
  const base = { resourceType: "MedicationRequest" as const, status: "active" };
  it("uses medicationCodeableConcept", () => {
    expect(medicationName({ ...base, medicationCodeableConcept: { coding: [{ display: "Aspirin" }] } }, known)).toBe("Aspirin");
  });
  it("resolves medicationReference via included, absolute and contained resources", () => {
    expect(medicationName({ ...base, medicationReference: { reference: "Medication/m1" } }, known)).toBe("Metformin 500 mg");
    expect(medicationName({ ...base, medicationReference: { reference: "https://x/fhir/Medication/m1" } }, known)).toBe("Metformin 500 mg");
    const contained: MedicationRequest = {
      ...base,
      contained: [{ resourceType: "Medication", id: "c1", code: { text: "Insulin" } }],
      medicationReference: { reference: "#c1" },
    };
    expect(medicationName(contained, known)).toBe("Insulin");
    expect(medicationName({ ...base, medicationReference: { reference: "Medication/zz", display: "Shown" } }, known)).toBe("Shown");
  });
  it("lists references that still need a GET", () => {
    const reqs: MedicationRequest[] = [
      { ...base, medicationReference: { reference: "Medication/m1" } },
      { ...base, medicationReference: { reference: "Medication/m2" } },
      { ...base, medicationReference: { reference: "Medication/m2/_history/1" } },
      { ...base, medicationReference: { reference: "#c" } },
    ];
    expect(unresolvedRefs(reqs, known)).toEqual(["Medication/m2"]);
    expect(normalizeRef("Medication/m2/_history/1")).toBe("Medication/m2");
  });
});

describe("proxy", () => {
  const base = new URL("https://fhir.example.com/fhir/TENANT");
  it("builds upstream URLs only for allowed resources", () => {
    expect(buildUpstreamUrl("GET", base, ["Patient"], "?name:contains=smi")?.toString()).toBe(
      "https://fhir.example.com/fhir/TENANT/Patient?name:contains=smi",
    );
    expect(buildUpstreamUrl("GET", base, ["Patient", "123"], "")?.toString()).toBe("https://fhir.example.com/fhir/TENANT/Patient/123");
    expect(buildUpstreamUrl("GET", base, ["Practitioner"], "")).toBeNull();
    expect(buildUpstreamUrl("GET", base, ["Patient", ".."], "")).toBeNull();
    expect(buildUpstreamUrl("GET", base, [], "")).toBeNull();
    expect(buildUpstreamUrl("GET", base, [], "?_getpages=abc&_getpagesoffset=50")?.toString()).toBe(
      "https://fhir.example.com/fhir/TENANT?_getpages=abc&_getpagesoffset=50",
    );
  });
  it("only allows reading paging links at the server base, never writing there", () => {
    // A POST/PUT to the base URL would run a transaction Bundle and bypass the resource allowlist.
    for (const m of ["POST", "PUT", "post", "DELETE", "PATCH"]) {
      expect(buildUpstreamUrl(m, base, [], "?_getpages=abc")).toBeNull();
    }
    expect(buildUpstreamUrl("POST", base, ["Patient"], "")?.toString()).toBe("https://fhir.example.com/fhir/TENANT/Patient");
  });
  it("rewrites paging links (http or https) to the proxy", () => {
    expect(toProxyUrl("http://fhir.example.com/fhir/TENANT?_getpages=x", base)).toBe("/api/fhir?_getpages=x");
    expect(toProxyUrl("https://fhir.example.com/fhir/TENANT/Patient?page=2", base)).toBe("/api/fhir/Patient?page=2");
    expect(toProxyUrl("https://evil.example.com/fhir/TENANT/Patient", base)).toBe("https://evil.example.com/fhir/TENANT/Patient");
    const b = rewriteBundleLinks({ resourceType: "Bundle", link: [{ relation: "next", url: "https://fhir.example.com/fhir/TENANT?_getpages=y" }] }, base) as { link: { url: string }[] };
    expect(b.link[0].url).toBe("/api/fhir?_getpages=y");
  });
  it("turns OperationOutcome into a message", () => {
    expect(outcomeMessage({ resourceType: "OperationOutcome", issue: [{ severity: "error", diagnostics: "Bad date" }] }, 400)).toBe("Bad date");
    expect(outcomeMessage(undefined, 404)).toMatch(/Not found/);
  });
});
