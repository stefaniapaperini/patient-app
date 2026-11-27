// Smoke test: the inspector's components render without crashing, with realistic data.
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { JsonTree } from "./JsonTree";
import { LearnTab } from "./LearnTab";
import { RequestCard } from "./RequestCard";
import { WhyEmpty } from "./WhyEmpty";
import { CodeChip } from "./CodeChip";
import type { LogEntry } from "@/lib/inspector/store";

const obs = {
  resourceType: "Observation",
  id: "o1",
  status: "final",
  code: { coding: [{ system: "http://loinc.org", code: "85354-9", display: "Blood pressure panel" }] },
  subject: { reference: "Patient/p1" },
  effectiveDateTime: "2024-01-02T10:00:00Z",
  component: [
    { code: { coding: [{ system: "http://loinc.org", code: "8480-6" }] }, valueQuantity: { value: 120, unit: "mm[Hg]" } },
    { code: { coding: [{ system: "http://loinc.org", code: "8462-4" }] }, valueQuantity: { value: 80, unit: "mm[Hg]" } },
  ],
};

describe("inspector components render", () => {
  it("JsonTree highlights fields and explains codes", () => {
    const html = renderToString(<JsonTree value={obs} highlight={["code.coding[*].code", "component[*].code.coding[*].code", "component[*].valueQuantity", "effectiveDateTime"]} />);
    expect(html).toContain("json-hl");
    expect(html).toContain("Systolic blood pressure"); // meaning of 8480-6, in an expanded highlighted path
    expect(html).toContain("LOINC: codes for observations");
  });
  it("RequestCard shows the request, its parameters and status", () => {
    const e: LogEntry = {
      id: 1, method: "GET", url: "/api/fhir/Observation?subject=Patient%2Fp1&code=8867-4", startedAt: 0, durationMs: 12, status: 200,
      responseBody: { resourceType: "Bundle", total: 1, entry: [{ resource: obs }] },
    };
    const html = renderToString(<RequestCard entries={[e]} defaultOpen />);
    expect(html).toContain("[base]/Observation?subject=Patient/p1&amp;code=8867-4");
    expect(html).toContain("Heart rate");
    expect(html).toContain("Bundle with 1 entry");
    expect(html).toContain("Open in console");
  });
  it("RequestCard shows a server error message", () => {
    const e: LogEntry = { id: 2, method: "GET", url: "/api/fhir/Patient?name:contains=x", startedAt: 0, status: 405, error: "HAPI-1258: :contains modifier is disabled" };
    expect(renderToString(<RequestCard entries={[e]} />)).toContain("HAPI-1258");
  });
  it("WhyEmpty, LearnTab and CodeChip render", () => {
    expect(renderToString(<WhyEmpty patientId="p1" label="Temperature" codes={["8310-5"]} />)).toContain("Check the server");
    expect(renderToString(<LearnTab />)).toContain("References");
    expect(renderToString(<CodeChip system="http://loinc.org" code="8867-4" />)).toContain("LOINC 8867-4");
  });
  it("SNOMED CT codes link to the SNOMED CT browser", () => {
    const chip = renderToString(<CodeChip system="http://snomed.info/sct" code="241046008" />);
    expect(chip).toContain("conceptId1=241046008");
    const tree = renderToString(<JsonTree value={{ coding: [{ system: "http://snomed.info/sct", code: "241046008" }] }} defaultDepth={9} />);
    expect(tree).toContain("look it up in the SNOMED CT browser");
    expect(tree).toContain("browser.ihtsdotools.org");
    // Anything that isn't a concept id is not put into a link.
    expect(renderToString(<CodeChip system="http://snomed.info/sct" code="x&y" />)).not.toContain("href");
    expect(renderToString(<LearnTab />)).toContain("semantic tag");
  });
});
