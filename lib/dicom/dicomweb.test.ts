import { describe, expect, it } from "vitest";
import { buildDicomUpstream, parseDemoPatients, type DicomConfig } from "../server/dicomweb";
import { dicomDate, renderedUrl, studyUidOf, tagText, toStudy, type DicomJson } from "./dicomweb";

const config: DicomConfig = {
  qido: new URL("https://dicom.example:8989/qido"),
  wado: new URL("https://dicom.example:8989/wado"),
  demoPatients: {},
};
const st = "1.2.826.0.1.3680043.6.1";
const se = "1.2.826.0.1.3680043.6.2";
const sop = "1.2.826.0.1.3680043.6.3";
const up = (path: string, search = "") => buildDicomUpstream(config, path.split("/"), search)?.toString() ?? null;

describe("DICOMweb proxy rules", () => {
  it("routes the searches and rendered images the viewer uses", () => {
    expect(up("qido/studies", "?PatientID=MC_EXAMPLE_1&includefield=0020000D")).toBe(
      "https://dicom.example:8989/qido/studies?PatientID=MC_EXAMPLE_1&includefield=0020000D",
    );
    expect(up(`qido/studies/${st}/series`)).toBe(`https://dicom.example:8989/qido/studies/${st}/series`);
    expect(up(`qido/studies/${st}/series/${se}/instances`, "?limit=100&offset=100")).not.toBeNull();
    expect(up(`wado/studies/${st}/series/${se}/instances/${sop}/rendered`)).toBe(
      `https://dicom.example:8989/wado/studies/${st}/series/${se}/instances/${sop}/rendered`,
    );
    expect(up(`wado/studies/${st}/series/${se}/instances/${sop}/frames/3/rendered`)).not.toBeNull();
  });
  it("refuses everything else: uploads, raw DICOM, other parameters and invalid UIDs", () => {
    expect(up("stow/studies")).toBeNull();
    expect(up(`wado/studies/${st}`)).toBeNull(); // the raw study, not a rendered image
    expect(up(`wado/studies/${st}/series/${se}/instances/${sop}`)).toBeNull();
    expect(up(`wado/studies/${st}/series/${se}/instances/${sop}/rendered`, "?quality=10")).toBeNull();
    expect(up("qido/studies", "?PatientName=Smith")).toBeNull();
    expect(up("qido/studies", "?PatientID=*")).toBeNull();
    expect(up("qido/studies", "?StudyInstanceUID=1.2.3,4.5.6")).toBeNull();
    expect(up("qido/studies", "?limit=-1")).toBeNull();
    expect(up("qido/studies/abc/series")).toBeNull();
    expect(up("qido/studies/../series")).toBeNull();
    expect(up(`qido/studies/${"1.".repeat(40)}1/series`)).toBeNull(); // longer than 64
  });
  it("reads demo links from .env and ignores malformed entries", () => {
    expect(parseDemoPatients(" p1:MC_EXAMPLE_1 , bad, :x, p2:MC_EXAMPLE_3,p3:*")).toEqual({ p1: "MC_EXAMPLE_1", p2: "MC_EXAMPLE_3" });
    expect(parseDemoPatients(undefined)).toEqual({});
  });
});

describe("DICOM JSON and FHIR ImagingStudy", () => {
  it("reads studies from QIDO results", () => {
    const o: DicomJson = {
      "0020000D": { vr: "UI", Value: [st] },
      "00100010": { vr: "PN", Value: [{ Alphabetic: "MC_Test_Patient_1" }] },
      "00080020": { vr: "DA", Value: ["20011114"] },
      "00080061": { vr: "CS", Value: ["CT"] },
      "00201208": { vr: "IS", Value: [36] },
    };
    expect(tagText(o, "00100010")).toBe("MC_Test_Patient_1");
    expect(toStudy(o)).toMatchObject({ uid: st, date: "2001-11-14", modalities: ["CT"], instanceCount: 36 });
    expect(dicomDate("2001")).toBeUndefined();
  });
  it("finds the StudyInstanceUID of a FHIR ImagingStudy", () => {
    expect(studyUidOf({ resourceType: "ImagingStudy", identifier: [{ system: "urn:dicom:uid", value: `urn:oid:${st}` }] })).toBe(st);
    // Synthea data uses another system for the same urn:oid value.
    expect(studyUidOf({ resourceType: "ImagingStudy", identifier: [{ system: "urn:ietf:rfc:3986", value: "urn:oid:1.2.840.99999999.1" }] })).toBe(
      "1.2.840.99999999.1",
    );
    expect(studyUidOf({ resourceType: "ImagingStudy", identifier: [{ value: "ACC123" }] })).toBeUndefined();
  });
  it("builds rendered image URLs through the proxy, per frame for multi-frame instances", () => {
    expect(renderedUrl(st, se, { sop })).toBe(`/api/dicomweb/wado/studies/${st}/series/${se}/instances/${sop}/rendered`);
    expect(renderedUrl(st, se, { sop, frame: 2 })).toBe(`/api/dicomweb/wado/studies/${st}/series/${se}/instances/${sop}/frames/2/rendered`);
  });
});
