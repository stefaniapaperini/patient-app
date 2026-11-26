import { describe, expect, it } from "vitest";
import {
  codeLabel,
  codeText,
  conditionOnset,
  formatDate,
  formatFrequency,
  formatName,
  formatDose,
  isConditionActive,
  isEnteredInError,
} from "./format";
import { buildNewPatient, buildUpdatedPatient, isPartialDate, patientToForm, validatePatient, type PatientFormValues } from "./patient";
import { chartRows, extractReadings, fhirTime, groupMeasurements, normalizeQuantity, unitFor, vitalsQuery } from "./vitals";
import { includedMedications, medicationName, normalizeRef, serverBase, unresolvedRefs } from "./medications";
import { outcomeMessage, proxyUrl } from "./client";
import { buildUpstreamUrl, filterDisallowed, REFUSED, rewriteBundleLinks, toProxyUrl, writeRefusal } from "../server/proxy";
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
  it("accepts partial birth dates (year, or year and month) as FHIR allows", () => {
    expect(validatePatient({ ...valid, birthDate: "1980" }, NOW).birthDate).toBeUndefined();
    expect(validatePatient({ ...valid, birthDate: "1980-04" }, NOW).birthDate).toBeUndefined();
    expect(validatePatient({ ...valid, birthDate: "1900" }, NOW).birthDate).toBeUndefined();
    expect(validatePatient({ ...valid, birthDate: "2026" }, NOW).birthDate).toBeUndefined();
    expect(validatePatient({ ...valid, birthDate: "2026-11" }, NOW).birthDate).toBeUndefined();
    expect(validatePatient({ ...valid, birthDate: "2026-12" }, NOW).birthDate).toMatch(/future/);
    expect(validatePatient({ ...valid, birthDate: "2027" }, NOW).birthDate).toMatch(/future/);
    expect(validatePatient({ ...valid, birthDate: "1899" }, NOW).birthDate).toMatch(/1900/);
    expect(validatePatient({ ...valid, birthDate: "1980-13" }, NOW).birthDate).toBeDefined();
    expect(isPartialDate("1980")).toBe(true);
    expect(isPartialDate("1980-04")).toBe(true);
    expect(isPartialDate("1980-04-12")).toBe(false);
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
    expect(u.meta).toBeUndefined(); // only versionId, which is server-managed
    expect(u.identifier).toEqual([{ value: "MRN1" }]);
    expect(u.name![0]).toEqual({ use: "official", given: ["Mary", "Ann"], family: "O'Brien-Smith", prefix: ["Mrs."] });
    expect(u.name![1]).toEqual({ use: "maiden", family: "Maid" });
    expect(u.telecom).toEqual([{ system: "email", value: "a@b.c" }, { system: "phone", value: "222222" }]);
    expect(u.birthDate).toBe("1980-04-12");
  });
  it("keeps stored given names when the name was not edited", () => {
    const original = { resourceType: "Patient", id: "p1", name: [{ use: "official", given: ["Mary Ann"], family: "Smith", text: "Mary Ann Smith" }] } as Patient;
    const u = buildUpdatedPatient(original, { given: "Mary Ann", family: "Smith", gender: "female", birthDate: "1980-04-12", phone: "123" });
    expect(u.name).toEqual(original.name);
    const renamed = buildUpdatedPatient(original, { given: "Mary Anne", family: "Smith", gender: "female", birthDate: "1980-04-12", phone: "" });
    expect(renamed.name![0]).toEqual({ use: "official", given: ["Mary", "Anne"], family: "Smith" });
    // Editing only the family name keeps the compound given name as one name.
    const married = buildUpdatedPatient(original, { given: "Mary Ann", family: "Jones", gender: "female", birthDate: "1980-04-12", phone: "" });
    expect(married.name![0]).toEqual({ use: "official", given: ["Mary Ann"], family: "Jones" });
  });
  it("drops the narrative when updating, since it describes the old demographics", () => {
    const original: Patient = {
      resourceType: "Patient",
      id: "p1",
      text: { status: "generated", div: "<div>John Smith, born 1980-01-01</div>" },
      name: [{ given: ["John"], family: "Smith" }],
    } as Patient;
    expect(buildUpdatedPatient(original, valid).text).toBeUndefined();
  });
  it("drops an 'extensions' narrative, which is also generated", () => {
    const original = { resourceType: "Patient", id: "p1", text: { status: "extensions", div: "<div>John</div>" } } as Patient;
    expect(buildUpdatedPatient(original, valid).text).toBeUndefined();
  });
  it("keeps a narrative people wrote when updating", () => {
    const text = { status: "additional", div: "<div>Interpreter required</div>" };
    const original = { resourceType: "Patient", id: "p1", text, name: [{ family: "Smith" }] } as Patient;
    expect(buildUpdatedPatient(original, valid).text).toEqual(text);
  });
  it("keeps meta tags, security labels and profiles when updating", () => {
    const original: Patient = {
      resourceType: "Patient",
      id: "p1",
      meta: {
        versionId: "3",
        lastUpdated: "2024-01-01T00:00:00Z",
        source: "#abc",
        profile: ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient"],
        security: [{ system: "http://terminology.hl7.org/CodeSystem/v3-Confidentiality", code: "R" }],
        tag: [{ system: "urn:example", code: "vip" }],
      },
      name: [{ given: ["A"], family: "B" }],
    };
    const u = buildUpdatedPatient(original, valid);
    expect(u.meta).toEqual({
      profile: original.meta!.profile,
      security: original.meta!.security,
      tag: original.meta!.tag,
    });
    expect(original.meta!.versionId).toBe("3"); // the original is not modified
  });
  it("keeps a partial birth date in the form instead of blanking it", () => {
    expect(patientToForm({ resourceType: "Patient", birthDate: "1980" }).birthDate).toBe("1980");
    expect(patientToForm({ resourceType: "Patient", birthDate: "1980-04" }).birthDate).toBe("1980-04");
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
    // A ruled-out diagnosis is never active, whatever its clinical status says.
    expect(isConditionActive({ ...c, verificationStatus: { coding: [{ code: "refuted" }] } })).toBe(false);
    expect(isConditionActive({ ...c, verificationStatus: { coding: [{ code: "provisional" }] } })).toBe(true);
    expect(isEnteredInError({ ...c, verificationStatus: { coding: [{ system: "x", code: "y" }, { code: "entered-in-error" }] } })).toBe(true);
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
  it("never merges two measurements taken at the same time", () => {
    const panel = (id: string, sys: number, dia?: number): Observation => ({
      resourceType: "Observation", id, code: loinc("85354-9"), effectiveDateTime: "2024-03-10",
      component: [
        { code: loinc("8480-6"), valueQuantity: { value: sys, unit: "mm[Hg]" } },
        ...(dia === undefined ? [] : [{ code: loinc("8462-4"), valueQuantity: { value: dia, unit: "mm[Hg]" } }]),
      ],
    });
    const m = groupMeasurements(extractReadings([panel("a", 160, 100), panel("b", 120, 80), panel("c", 130)]), "bp");
    expect(m.map((x) => x.values)).toEqual([
      { systolic: 160, diastolic: 100 },
      { systolic: 120, diastolic: 80 },
      { systolic: 130 },
    ]);
  });
  it("pairs standalone systolic and diastolic only when unambiguous", () => {
    const one = (id: string, code: string, value: number): Observation => ({
      resourceType: "Observation", id, code: loinc(code), effectiveDateTime: "2024-03-10T09:00:00Z", valueQuantity: { value, unit: "mm[Hg]" },
    });
    const paired = groupMeasurements(extractReadings([one("s", "8480-6", 120), one("d", "8462-4", 80)]), "bp");
    expect(paired).toHaveLength(1);
    expect(paired[0].values).toEqual({ systolic: 120, diastolic: 80 });
    expect(paired[0].observationIds).toEqual(["s", "d"]);
    const ambiguous = groupMeasurements(
      extractReadings([one("s1", "8480-6", 160), one("s2", "8480-6", 120), one("d1", "8462-4", 100), one("d2", "8462-4", 80)]),
      "bp",
    );
    expect(ambiguous).toHaveLength(4);
  });
  it("reads date-only values as local dates, not UTC midnight", () => {
    const d = new Date(fhirTime("2024-03-10"));
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2024, 2, 10, 0]);
    expect(new Date(fhirTime("2024-03")).getDate()).toBe(1);
    expect(fhirTime("2024-03-10T10:00:00Z")).toBe(Date.UTC(2024, 2, 10, 10));
  });
  it("converts lb, in and °F to kg, cm and Cel", () => {
    expect(normalizeQuantity({ value: 100, unit: "lb", code: "[lb_av]" }).unit).toBe("kg");
    expect(normalizeQuantity({ value: 100, unit: "lb", code: "[lb_av]" }).value).toBeCloseTo(45.359, 3);
    expect(normalizeQuantity({ value: 10, unit: "in" })).toEqual({ value: 25.4, unit: "cm" });
    expect(normalizeQuantity({ value: 212, code: "[degF]" })).toEqual({ value: 100, unit: "Cel" });
    expect(normalizeQuantity({ value: 70, unit: "kg", code: "kg" })).toEqual({ value: 70, unit: "kg" });
  });
  it("charts one unit per vital", () => {
    const w = (id: string, value: number, unit: string, code: string, date: string): Observation => ({
      resourceType: "Observation", id, code: loinc("29463-7"), effectiveDateTime: date, valueQuantity: { value, unit, code },
    });
    const r = extractReadings([
      w("a", 70, "kg", "kg", "2024-01-01T10:00:00Z"),
      w("b", 160, "lb", "[lb_av]", "2024-02-01T10:00:00Z"),
      w("c", 71, "kg", "kg", "2024-03-01T10:00:00Z"),
      w("d", 11, "stone", "[stone_av]", "2024-04-01T10:00:00Z"),
    ]);
    expect(unitFor(r, "weight")).toBe("kg");
    const rows = chartRows(r, "weight", "kg");
    expect(rows).toHaveLength(3); // lb converted; the unconvertible "stone" reading is left off
    expect(rows[1].value).toBeCloseTo(72.57, 2);
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
    expect(medicationName({ ...base, medicationReference: { reference: "https://x/fhir/Medication/m1" } }, known, "https://x/fhir")).toBe(
      "Metformin 500 mg",
    );
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
  it("never resolves a reference to another server against this one", () => {
    const other = { ...base, medicationReference: { reference: "https://other.org/fhir/Medication/m1", display: "Other drug" } };
    expect(medicationName(other, known, "https://x/fhir")).toBe("Other drug");
    expect(medicationName(other, known)).toBe("Other drug");
    expect(unresolvedRefs([other], new Map(), "https://x/fhir")).toEqual([]);
    expect(normalizeRef("https://x/fhir/Medication/m2/_history/1", "https://x/fhir/")).toBe("Medication/m2");
    // Root-relative: may be another server's Medication when the FHIR base has a path.
    expect(normalizeRef("/Medication/m2")).toBe("/Medication/m2");
    expect(unresolvedRefs([{ ...base, medicationReference: { reference: "/Medication/m2" } }], new Map(), "https://x/fhir")).toEqual([]);
  });
  it("finds the server base from entry.fullUrl", () => {
    expect(serverBase([{ fullUrl: "https://x/fhir/MedicationRequest/r1", resource: { resourceType: "MedicationRequest", id: "r1" } as never }])).toBe(
      "https://x/fhir",
    );
    expect(serverBase([{ resource: { resourceType: "MedicationRequest", id: "r1" } as never }])).toBeUndefined();
  });
});

describe("doses", () => {
  it("shows the dose exactly as recorded", () => {
    expect(formatDose({ doseAndRate: [{ doseQuantity: { value: 0.125, unit: "mg" } }] })).toBe("0.125 mg");
    expect(formatDose({ doseAndRate: [{ doseQuantity: { value: 0.0625, unit: "mg" } }] })).toBe("0.0625 mg");
  });
});

describe("proxy", () => {
  const base = new URL("https://fhir.example.com/fhir/TENANT");
  it("refuses cross-site writes", () => {
    const h = (o: Record<string, string>) => new Headers(o);
    const json = { "content-type": "application/fhir+json" };
    expect(writeRefusal(h({ ...json, "sec-fetch-site": "same-origin" }), "app.local")).toBeNull();
    expect(writeRefusal(h({ ...json, "sec-fetch-site": "cross-site" }), "app.local")).not.toBeNull();
    expect(writeRefusal(h({ ...json, "sec-fetch-site": "same-site" }), "app.local")).not.toBeNull();
    // Older browsers: Origin only.
    expect(writeRefusal(h({ ...json, origin: "http://app.local" }), "app.local")).toBeNull();
    expect(writeRefusal(h({ ...json, origin: "https://evil.example" }), "app.local")).not.toBeNull();
    // A simple (no-preflight) cross-site body type is refused even without Fetch metadata.
    expect(writeRefusal(h({ "content-type": "text/plain" }), "app.local")).not.toBeNull();
    // curl and scripts send neither header.
    expect(writeRefusal(h({ "content-type": "application/json; charset=utf-8" }), "app.local")).toBeNull();
  });
  it("removes resource types outside the allowlist from responses", () => {
    // _revinclude=*, _include of a Practitioner, or Patient/1/Encounter return other types.
    const bundle = {
      resourceType: "Bundle",
      total: 1,
      entry: [
        { resource: { resourceType: "Patient", id: "1" } },
        { resource: { resourceType: "Encounter", id: "e" } },
        { resource: { resourceType: "Practitioner", id: "pr" } },
        { resource: { resourceType: "OperationOutcome" } },
      ],
    };
    const out = filterDisallowed(bundle) as typeof bundle;
    expect(out.entry.map((e) => e.resource.resourceType)).toEqual(["Patient", "OperationOutcome"]);
    expect(filterDisallowed({ resourceType: "Encounter", id: "5" })).toBe(REFUSED);
    expect(filterDisallowed({ resourceType: "Patient", id: "5" })).toEqual({ resourceType: "Patient", id: "5" });
    expect(filterDisallowed({ error: "gateway" })).toEqual({ error: "gateway" });
    expect(filterDisallowed(null)).toBeNull();
  });
  it("keeps contained resources, which are part of the resource that holds them", () => {
    const req = {
      resourceType: "MedicationRequest",
      contained: [
        { resourceType: "Practitioner", id: "pr" },
        { resourceType: "Medication", id: "m" },
      ],
    };
    // Stripping them would delete them on the server when an edited Patient is PUT back.
    const single = filterDisallowed(structuredClone(req)) as typeof req;
    expect(single.contained.map((c) => c.resourceType)).toEqual(["Practitioner", "Medication"]);
    const bundle = filterDisallowed({ resourceType: "Bundle", entry: [{ resource: structuredClone(req) }] }) as {
      entry: { resource: typeof req }[];
    };
    expect(bundle.entry[0].resource.contained.map((c) => c.resourceType)).toEqual(["Practitioner", "Medication"]);
  });
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
  it("only allows the writes the app makes: POST /Patient and PUT /Patient/{id}", () => {
    expect(buildUpstreamUrl("PUT", base, ["Patient", "123"], "")?.toString()).toBe("https://fhir.example.com/fhir/TENANT/Patient/123");
    expect(buildUpstreamUrl("POST", base, ["Observation"], "")).toBeNull();
    expect(buildUpstreamUrl("PUT", base, ["Condition", "1"], "")).toBeNull();
    expect(buildUpstreamUrl("POST", base, ["Patient", "123"], "")).toBeNull();
    expect(buildUpstreamUrl("POST", base, ["Patient", "_search"], "")).toBeNull();
    expect(buildUpstreamUrl("PUT", base, ["Patient"], "?name=x")).toBeNull(); // conditional update
    expect(buildUpstreamUrl("PUT", base, ["Patient", "_history"], "")).toBeNull();
    expect(buildUpstreamUrl("DELETE", base, ["Patient", "123"], "")).toBeNull();
    expect(buildUpstreamUrl("GET", base, ["Observation"], "?subject=Patient/1")).not.toBeNull();
  });
  it("proxies paging links even when the server reports another host or path", () => {
    expect(toProxyUrl("http://hapi:8080/fhir/TENANT/Patient?page=2", base)).toBe("/api/fhir/Patient?page=2");
    expect(toProxyUrl("http://hapi:8080/fhir?_getpages=abc&_getpagesoffset=50", base)).toBe("/api/fhir?_getpages=abc&_getpagesoffset=50");
    expect(toProxyUrl("https://other.example.com/elsewhere/Patient", base)).toBe("https://other.example.com/elsewhere/Patient");
    expect(toProxyUrl("javascript:alert(1)", base)).toBe("javascript:alert(1)");
  });
  it("refuses to fetch absolute URLs from the browser", () => {
    expect(() => proxyUrl("http://hapi:8080/fhir/Patient")).toThrow(/cannot follow/);
    expect(proxyUrl("/api/fhir?_getpages=x")).toBe("/api/fhir?_getpages=x");
    expect(proxyUrl("/api/fhir/Patient/1")).toBe("/api/fhir/Patient/1");
    expect(proxyUrl("?_getpages=x")).toBe("/api/fhir?_getpages=x");
    expect(proxyUrl("Patient?name=a")).toBe("/api/fhir/Patient?name=a");
  });
  it("rewrites paging links (http or https) to the proxy", () => {
    expect(toProxyUrl("http://fhir.example.com/fhir/TENANT?_getpages=x", base)).toBe("/api/fhir?_getpages=x");
    expect(toProxyUrl("https://fhir.example.com/fhir/TENANT/Patient?page=2", base)).toBe("/api/fhir/Patient?page=2");
    // Same path, other host: proxied, which only ever reaches FHIR_BASE_URL.
    expect(toProxyUrl("https://evil.example.com/fhir/TENANT/Patient", base)).toBe("/api/fhir/Patient");
    const b = rewriteBundleLinks({ resourceType: "Bundle", link: [{ relation: "next", url: "https://fhir.example.com/fhir/TENANT?_getpages=y" }] }, base) as { link: { url: string }[] };
    expect(b.link[0].url).toBe("/api/fhir?_getpages=y");
  });
  it("turns OperationOutcome into a message", () => {
    expect(outcomeMessage({ resourceType: "OperationOutcome", issue: [{ severity: "error", diagnostics: "Bad date" }] }, 400)).toBe("Bad date");
    expect(outcomeMessage(undefined, 404)).toMatch(/Not found/);
  });
});
