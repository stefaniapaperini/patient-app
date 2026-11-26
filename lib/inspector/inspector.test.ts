import { describe, expect, it } from "vitest";
import { explainRequest, splitUrl, toCurl } from "./explain";
import { fieldDoc, normalizePath } from "./glossary";
import { entriesFor, type LogEntry } from "./store";
import { isHighlighted } from "../../components/inspector/JsonTree";

describe("explainRequest", () => {
  it("explains a search with codes and a modifier", () => {
    const ex = explainRequest("get", "/api/fhir/Observation?subject=Patient%2F1&code=8867-4%2C8310-5&_count=200");
    expect(ex.method).toBe("GET");
    expect(ex.resourceType).toBe("Observation");
    expect(ex.interaction).toMatch(/Search/);
    const code = ex.params.find((p) => p.base === "code")!;
    expect(code.values).toEqual([
      { value: "8867-4", meaning: "Heart rate" },
      { value: "8310-5", meaning: "Body temperature" },
    ]);
    const m = explainRequest("GET", "Patient?name:contains=rit").params[0];
    expect(m).toMatchObject({ base: "name", modifier: "contains" });
    expect(m.text).toMatch(/anywhere/);
  });
  it("names read, create, update and paging", () => {
    expect(explainRequest("GET", "Patient/123")).toMatchObject({ interaction: expect.stringMatching(/^Read/), id: "123" });
    expect(explainRequest("POST", "Patient").interaction).toMatch(/^Create/);
    expect(explainRequest("PUT", "Patient/1").interaction).toMatch(/^Update/);
    expect(explainRequest("GET", "/api/fhir?_getpages=abc").interaction).toMatch(/Next page/);
    expect(explainRequest("GET", "Patient/1/_history").interaction).toMatch(/History/);
  });
});

describe("toCurl", () => {
  it("uses the .env variables, never a real token", () => {
    const c = toCurl("GET", "/api/fhir/Patient?name=a");
    expect(c).toContain('curl -X GET "$FHIR_BASE_URL/Patient?name=a"');
    expect(c).toContain('Authorization: Bearer $FHIR_TOKEN');
    expect(toCurl("GET", "/api/fhir?_getpages=x")).toContain('"$FHIR_BASE_URL?_getpages=x"');
  });
  it("adds a body, escaping single quotes for the shell", () => {
    const c = toCurl("POST", "/api/fhir/Patient", { resourceType: "Patient", name: [{ family: "O'Brien" }] });
    expect(c).toContain("--data '");
    expect(c).toContain(`O'\\''Brien`);
  });
  it("splits proxy and plain URLs the same way", () => {
    expect(splitUrl("/api/fhir/Patient?x=1")).toEqual({ path: "Patient", query: "x=1" });
    expect(splitUrl("Patient/1")).toEqual({ path: "Patient/1", query: "" });
  });
});

describe("highlighting and field docs", () => {
  it("matches fields, their children and any array index", () => {
    expect(isHighlighted("valueQuantity", ["valueQuantity"])).toBe(true);
    expect(isHighlighted("valueQuantity.value", ["valueQuantity"])).toBe(true);
    expect(isHighlighted("valueQuantityX", ["valueQuantity"])).toBe(false);
    expect(isHighlighted("component[1].valueQuantity.value", ["component[*].valueQuantity"])).toBe(true);
    expect(isHighlighted("component[1].code", ["component[*].valueQuantity"])).toBe(false);
    expect(isHighlighted("name[0].given[1]", ["name"])).toBe(true);
  });
  it("explains fields from the most specific entry", () => {
    expect(normalizePath("component[0].valueQuantity.value")).toBe("component.valueQuantity.value");
    expect(fieldDoc("Patient", "birthDate")).toMatch(/year/);
    expect(fieldDoc("Observation", "component[0].valueQuantity.value")).toBe("The number.");
    expect(fieldDoc("Observation", "code.coding[0].system")).toMatch(/code system/);
    expect(fieldDoc("Patient", "somethingUnknown")).toBeUndefined();
  });
});

describe("request log", () => {
  const e = (id: number, url: string, group = url): LogEntry => ({ id, method: "GET", url, group, startedAt: 0 });
  it("returns the latest run of a search with its later pages", () => {
    const log = [
      e(1, "/api/fhir/Observation?a"),
      e(2, "/api/fhir?_getpages=old", "/api/fhir/Observation?a"),
      e(3, "/api/fhir/Patient/1"),
      e(4, "/api/fhir/Observation?a"),
      e(5, "/api/fhir?_getpages=new", "/api/fhir/Observation?a"),
    ];
    expect(entriesFor(log, "/api/fhir/Observation?a").map((x) => x.id)).toEqual([4, 5]);
    expect(entriesFor(log, "/api/fhir/Patient/1").map((x) => x.id)).toEqual([3]);
    expect(entriesFor(log, "/api/fhir/Condition")).toEqual([]);
  });
});
