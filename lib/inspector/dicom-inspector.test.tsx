import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { patientStudiesUrl, qido, slicesOfSeries } from "../dicom/dicomweb";
import { dicomDisplayUrl, explainDicomRequest, isDicomUrl, toDicomCurl } from "./explain";
import { dicomTagName, fieldDoc } from "./glossary";
import { getInspectorState, setEnabled } from "./store";
import { RequestCard } from "../../components/inspector/RequestCard";
import { LearnTab } from "../../components/inspector/LearnTab";
import { JsonTree } from "../../components/inspector/JsonTree";

const st = "1.2.826.0.1.3680043.6.1";
const se = "1.2.826.0.1.3680043.6.2";
const sop = "1.2.826.0.1.3680043.6.3";

describe("DICOMweb requests in the inspector", () => {
  it("tells DICOMweb requests from FHIR ones", () => {
    expect(isDicomUrl("/api/dicomweb/qido/studies")).toBe(true);
    expect(isDicomUrl("/api/fhir/Patient")).toBe(false);
  });
  it("explains a QIDO-RS search, naming the tags it asks for", () => {
    const ex = explainDicomRequest(`/api/dicomweb/qido/studies?PatientID=MC_EXAMPLE_1&includefield=0020000D&limit=5`);
    expect(ex.service).toBe("QIDO-RS");
    expect(ex.interaction).toMatch(/^Search for studies on the whole server/);
    expect(ex.params.map((p) => p.name)).toEqual(["PatientID", "includefield", "limit"]);
    expect(ex.params[1].text).toMatch(/StudyInstanceUID/);
    const series = explainDicomRequest(`/api/dicomweb/qido/studies/${st}/series/${se}/instances?offset=100`);
    expect(series.interaction).toMatch(/instances of one series/);
    expect(series.uids.map((u) => u.label)).toEqual(["Study", "Series"]);
  });
  it("explains a WADO-RS rendered image, per frame too", () => {
    const ex = explainDicomRequest(`/api/dicomweb/wado/studies/${st}/series/${se}/instances/${sop}/rendered`);
    expect(ex.service).toBe("WADO-RS");
    expect(ex.interaction).toMatch(/rendered by the server as JPEG/);
    expect(ex.uids.map((u) => u.label)).toEqual(["Study", "Series", "Instance"]);
    expect(explainDicomRequest(`/api/dicomweb/wado/studies/${st}/series/${se}/instances/${sop}/frames/2/rendered`).interaction).toMatch(/frame 2/);
  });
  it("displays the service instead of the proxy path", () => {
    expect(dicomDisplayUrl("/api/dicomweb/qido/studies?PatientID=A%20B")).toBe("[QIDO-RS]/studies?PatientID=A B");
    expect(dicomDisplayUrl(`/api/dicomweb/wado/studies/${st}/series/${se}/instances/${sop}/rendered`)).toMatch(/^\[WADO-RS\]\/studies\//);
  });
  it("builds a curl command where nothing from the page can run in the shell", () => {
    const marker = join(tmpdir(), `dicom-curl-inject-${process.pid}-${Date.now()}`);
    const evil = `$(touch ${marker})\`touch ${marker}\`'x`;
    const cmd = toDicomCurl(`/api/dicomweb/qido/studies?PatientID=${evil}`);
    const out = execFileSync("bash", ["-c", `curl() { printf '%s\\n' "$@"; }\n${cmd}`], {
      env: { ...process.env, DICOMWEB_QIDO_URL: "https://dicom.test/qido" },
      encoding: "utf8",
    }).split("\n");
    expect(existsSync(marker)).toBe(false);
    expect(out).toContain(`https://dicom.test/qido/studies?PatientID=${evil}`);
    expect(out).toContain("Accept: application/dicom+json");
    expect(toDicomCurl(`/api/dicomweb/wado/studies/${st}/series/${se}/instances/${sop}/rendered`)).toMatch(
      /^curl "\$\{DICOMWEB_WADO_URL:-\$DICOMWEB_QIDO_URL\}"'\/studies\/.*\/rendered' \\\n {2}-H "Accept: image\/jpeg" -o image\.jpg$/,
    );
  });
  it("an image's curl command falls back to the QIDO URL when no WADO URL is set", () => {
    const cmd = toDicomCurl(`/api/dicomweb/wado/studies/${st}/series/${se}/instances/${sop}/rendered`);
    const run = (env: Record<string, string>) =>
      execFileSync("bash", ["-c", `curl() { printf '%s\\n' "$1"; }\n${cmd}`], { env: { ...process.env, DICOMWEB_QIDO_URL: "", DICOMWEB_WADO_URL: "", ...env }, encoding: "utf8" }).trim();
    expect(run({ DICOMWEB_QIDO_URL: "https://dicom.test/root" })).toBe(`https://dicom.test/root/studies/${st}/series/${se}/instances/${sop}/rendered`);
    expect(run({ DICOMWEB_QIDO_URL: "https://q.test", DICOMWEB_WADO_URL: "https://w.test" })).toMatch(/^https:\/\/w\.test\/studies\//);
  });
  it("names DICOM tags in DICOM JSON", () => {
    expect(dicomTagName("0020000d")).toBe("StudyInstanceUID");
    expect(fieldDoc(undefined, "[0].0020000D")).toMatch(/^\(0020,000D\) StudyInstanceUID: /);
    expect(fieldDoc(undefined, "[0].00191010")).toBe("DICOM tag (0019,1010).");
    const html = renderToString(<JsonTree value={[{ "0020000D": { vr: "UI", Value: [st] } }]} defaultDepth={3} />);
    expect(html).toContain("StudyInstanceUID");
  });
});

describe("DICOMweb searches are logged like FHIR requests", () => {
  afterEach(() => {
    setEnabled(false);
    vi.unstubAllGlobals();
  });
  const stubFetch = (status: number, body?: unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/dicom+json" } })),
    );

  it("records nothing while the inspector is off", async () => {
    stubFetch(200, []);
    await qido(patientStudiesUrl("MC_EXAMPLE_1"));
    expect(getInspectorState().log).toHaveLength(0);
  });
  it("records the search, its DICOM JSON and a 204 no-match", async () => {
    setEnabled(true);
    stubFetch(200, [{ "0020000D": { vr: "UI", Value: [st] } }]);
    await qido(patientStudiesUrl("MC_EXAMPLE_1"));
    stubFetch(204);
    expect(await qido("/api/dicomweb/qido/studies?StudyInstanceUID=1.2.3")).toEqual([]);
    const [a, b] = getInspectorState().log;
    expect(a).toMatchObject({ method: "GET", url: patientStudiesUrl("MC_EXAMPLE_1"), status: 200 });
    expect(a.responseBody).toHaveLength(1);
    expect(b.status).toBe(204);
    expect(b.responseBody).toBeUndefined();
  });
  it("pages a series by what the server returns, until an empty page", async () => {
    // A server that caps pages at 2 results, with 5 instances.
    const all = [1, 2, 3, 4, 5].map((n) => ({ "00080018": { vr: "UI", Value: [`1.2.3.${n}`] }, "00200013": { vr: "IS", Value: [n] } }));
    const offsets: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const offset = Number(new URL(url, "http://x").searchParams.get("offset"));
        offsets.push(offset);
        const page = all.slice(offset, offset + 2);
        return page.length ? new Response(JSON.stringify(page), { status: 200 }) : new Response(null, { status: 204 });
      }),
    );
    expect((await slicesOfSeries(st, se)).map((s) => s.instanceNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(offsets).toEqual([0, 2, 4, 5]);
    // With the series' instance count known, no extra request for the empty page.
    offsets.length = 0;
    expect(await slicesOfSeries(st, se, undefined, 5)).toHaveLength(5);
    expect(offsets).toEqual([0, 2, 4]);
  });
  it("records refused requests with the proxy's message", async () => {
    setEnabled(true);
    stubFetch(403, { error: "The imaging proxy does not allow …" });
    await expect(qido("/api/dicomweb/qido/studies?PatientName=x")).rejects.toThrow(/does not allow/);
    expect(getInspectorState().log[0]).toMatchObject({ status: 403, error: expect.stringMatching(/does not allow/) });
  });
});

describe("imaging inspector components render", () => {
  it("a logged DICOMweb search: explanation, no console link", () => {
    const html = renderToString(
      <RequestCard
        entries={[{ id: 1, method: "GET", url: patientStudiesUrl("MC_EXAMPLE_1"), startedAt: 0, status: 200, durationMs: 40, responseBody: [{}] }]}
      />,
    );
    expect(html).toContain("QIDO-RS");
    expect(html).toContain("1 result (DICOM JSON)");
    expect(html).not.toContain("Open in console");
  });
  it("the Learn tab has the DICOM sections", () => {
    const html = renderToString(<LearnTab />);
    expect(html).toContain("DICOM: medical images and their data");
    expect(html).toContain("DICOMweb: DICOM over the web");
    expect(html).toContain("FHIR meets DICOM");
  });
});
