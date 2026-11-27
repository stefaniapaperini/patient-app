/**
 * Browser side of DICOMweb: QIDO-RS searches and WADO-RS rendered images, always through the
 * app's read-only proxy (/api/dicomweb). Results are DICOM JSON: objects keyed by tag
 * ("0020000D") with { vr, Value: [...] }.
 */
import type { ImagingStudy } from "../fhir/types";
import { recordRequest } from "../inspector/store";

export const DICOMWEB_BASE = "/api/dicomweb";

export type DicomJson = Record<string, { vr?: string; Value?: unknown[] }>;

/** DICOM tags used here. */
export const TAG = {
  StudyInstanceUID: "0020000D",
  SeriesInstanceUID: "0020000E",
  SOPInstanceUID: "00080018",
  PatientID: "00100020",
  StudyDate: "00080020",
  StudyDescription: "00081030",
  ModalitiesInStudy: "00080061",
  Modality: "00080060",
  SeriesDescription: "0008103E",
  SeriesNumber: "00200011",
  InstanceNumber: "00200013",
  NumberOfFrames: "00280008",
  NumberOfStudyRelatedSeries: "00201206",
  NumberOfStudyRelatedInstances: "00201208",
  NumberOfSeriesRelatedInstances: "00201209",
} as const;

/** First value of a tag as text (a person name gives its Alphabetic form). */
export function tagText(o: DicomJson | undefined, tag: string): string | undefined {
  const v = o?.[tag]?.Value?.[0];
  if (v === undefined || v === null) return undefined;
  if (typeof v === "object") return (v as { Alphabetic?: string }).Alphabetic;
  return String(v);
}

export function tagNumber(o: DicomJson | undefined, tag: string): number | undefined {
  const t = tagText(o, tag);
  const n = t === undefined ? NaN : Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** DICOM date "20011114" -> FHIR-style "2001-11-14" (so the app's date formatting applies). */
export function dicomDate(d: string | undefined): string | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(d ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

export interface ImagingConfig {
  enabled: boolean;
  demoPatients: Record<string, string>;
}

export async function imagingConfig(signal?: AbortSignal): Promise<ImagingConfig> {
  const res = await fetch(DICOMWEB_BASE, { signal });
  if (!res.ok) throw new Error(await errorText(res));
  return (await res.json()) as ImagingConfig;
}

async function errorText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => undefined)) as { error?: string } | undefined;
  return body?.error ?? `The imaging service returned HTTP ${res.status}.`;
}

/**
 * A QIDO-RS search through the proxy; `url` is a proxy URL from one of the builders below.
 * "No match" (204) is an empty list. Like FHIR requests, it is recorded in the FHIR Inspector's
 * request log while the inspector is on; `group` ties the pages of one long list together.
 */
export async function qido(url: string, signal?: AbortSignal, group?: string): Promise<DicomJson[]> {
  const done = recordRequest({ method: "GET", url, group: group ?? url });
  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { Accept: "application/dicom+json" } });
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    done({ status: 0, error: aborted ? "Cancelled (the page no longer needed this request)." : "Network error: could not reach the app server." });
    throw e;
  }
  if (res.status === 204) {
    done({ status: 204 });
    return [];
  }
  if (!res.ok) {
    const message = await errorText(res);
    done({ status: res.status, error: message });
    throw new Error(message);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (e) {
    done({ status: res.status, error: "The response could not be read." });
    throw e;
  }
  done({ status: res.status, responseBody: body });
  return Array.isArray(body) ? (body as DicomJson[]) : [];
}

const fields = (...tags: string[]) => tags.map((t) => `includefield=${t}`).join("&");

/** Results asked for per QIDO request (servers may return fewer: they can cap pages lower). */
const QIDO_PAGE = 100;

export interface DicomStudy {
  uid: string;
  /** The QIDO-RS result as returned (DICOM JSON), for the inspector. */
  raw: DicomJson;
  patientId?: string;
  date?: string;
  description?: string;
  modalities: string[];
  seriesCount?: number;
  instanceCount?: number;
}

const STUDY_FIELDS = fields(
  TAG.StudyInstanceUID,
  TAG.PatientID,
  TAG.StudyDate,
  TAG.StudyDescription,
  TAG.ModalitiesInStudy,
  TAG.NumberOfStudyRelatedSeries,
  TAG.NumberOfStudyRelatedInstances,
);

export function toStudy(o: DicomJson): DicomStudy | undefined {
  const uid = tagText(o, TAG.StudyInstanceUID);
  if (!uid) return undefined;
  return {
    uid,
    raw: o,
    patientId: tagText(o, TAG.PatientID),
    date: dicomDate(tagText(o, TAG.StudyDate)),
    description: tagText(o, TAG.StudyDescription),
    modalities: (o[TAG.ModalitiesInStudy]?.Value ?? []).map(String),
    seriesCount: tagNumber(o, TAG.NumberOfStudyRelatedSeries),
    instanceCount: tagNumber(o, TAG.NumberOfStudyRelatedInstances),
  };
}

/** QIDO-RS: the study with this StudyInstanceUID. */
export const studyLookupUrl = (uid: string) => `${DICOMWEB_BASE}/qido/studies?StudyInstanceUID=${encodeURIComponent(uid)}&${STUDY_FIELDS}`;
/** QIDO-RS: all studies of one DICOM patient. */
export const patientStudiesUrl = (dicomPatientId: string) =>
  `${DICOMWEB_BASE}/qido/studies?PatientID=${encodeURIComponent(dicomPatientId)}&${STUDY_FIELDS}`;
/** QIDO-RS: the series of a study. */
export const seriesUrl = (studyUid: string) =>
  `${DICOMWEB_BASE}/qido/studies/${studyUid}/series?${fields(TAG.SeriesInstanceUID, TAG.SeriesNumber, TAG.Modality, TAG.SeriesDescription, TAG.NumberOfSeriesRelatedInstances)}`;
/** QIDO-RS: one page of the instances (images) of a series. */
export const instancesUrl = (studyUid: string, seriesUid: string, offset = 0) =>
  `${DICOMWEB_BASE}/qido/studies/${studyUid}/series/${seriesUid}/instances?limit=${QIDO_PAGE}&offset=${offset}&${fields(TAG.SOPInstanceUID, TAG.InstanceNumber, TAG.NumberOfFrames)}`;

/** The study with this StudyInstanceUID on the DICOM server, or undefined if it isn't there. */
export async function findStudy(uid: string, signal?: AbortSignal): Promise<DicomStudy | undefined> {
  const found = await qido(studyLookupUrl(uid), signal);
  return found.map(toStudy).find((s) => s?.uid === uid);
}

/** The studies of one DICOM patient, newest first. */
export async function studiesOfPatient(dicomPatientId: string, signal?: AbortSignal): Promise<DicomStudy[]> {
  const found = await qido(patientStudiesUrl(dicomPatientId), signal);
  return found
    .map(toStudy)
    .filter((s): s is DicomStudy => !!s && s.patientId === dicomPatientId)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

export interface DicomSeries {
  uid: string;
  /** The QIDO-RS result as returned (DICOM JSON), for the inspector. */
  raw: DicomJson;
  number?: number;
  modality?: string;
  description?: string;
  instanceCount?: number;
}

export async function seriesOfStudy(studyUid: string, signal?: AbortSignal): Promise<DicomSeries[]> {
  const found = await qido(seriesUrl(studyUid), signal);
  return found
    .map((o) => ({
      raw: o,
      uid: tagText(o, TAG.SeriesInstanceUID) ?? "",
      number: tagNumber(o, TAG.SeriesNumber),
      modality: tagText(o, TAG.Modality),
      description: tagText(o, TAG.SeriesDescription),
      instanceCount: tagNumber(o, TAG.NumberOfSeriesRelatedInstances),
    }))
    .filter((s) => s.uid)
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
}

/** One image to show: an instance, or one frame of a multi-frame instance. */
export interface Slice {
  sop: string;
  /** The instance's QIDO-RS result (DICOM JSON), for the inspector. */
  raw?: DicomJson;
  instanceNumber?: number;
  /** 1-based frame number, only for multi-frame instances. */
  frame?: number;
}

const MAX_INSTANCES = 2000;

/**
 * All images of a series, in instance order, expanding multi-frame instances into frames.
 * Pages through the instances: a server may return fewer than asked per page, so the offset moves
 * by what came back, and only an empty page (or reaching `expected`, the series' instance count
 * when known) ends the list.
 */
export async function slicesOfSeries(studyUid: string, seriesUid: string, signal?: AbortSignal, expected?: number): Promise<Slice[]> {
  const instances: DicomJson[] = [];
  const group = instancesUrl(studyUid, seriesUid);
  let offset = 0;
  while (offset < MAX_INSTANCES) {
    const page = await qido(instancesUrl(studyUid, seriesUid, offset), signal, group);
    if (page.length === 0) break;
    instances.push(...page);
    offset += page.length;
    if (expected !== undefined && offset >= expected) break;
  }
  const seen = new Set<string>();
  const slices: Slice[] = [];
  for (const o of instances) {
    const sop = tagText(o, TAG.SOPInstanceUID);
    if (!sop || seen.has(sop)) continue;
    seen.add(sop);
    const instanceNumber = tagNumber(o, TAG.InstanceNumber);
    const frames = tagNumber(o, TAG.NumberOfFrames) ?? 1;
    if (frames > 1) for (let f = 1; f <= frames; f++) slices.push({ sop, raw: o, instanceNumber, frame: f });
    else slices.push({ sop, raw: o, instanceNumber });
  }
  return slices.sort((a, b) => (a.instanceNumber ?? 0) - (b.instanceNumber ?? 0) || (a.frame ?? 0) - (b.frame ?? 0));
}

/** The URL of one image, rendered to JPEG by the DICOM server (WADO-RS /rendered). */
export function renderedUrl(studyUid: string, seriesUid: string, slice: Slice): string {
  const base = `${DICOMWEB_BASE}/wado/studies/${studyUid}/series/${seriesUid}/instances/${slice.sop}`;
  return slice.frame ? `${base}/frames/${slice.frame}/rendered` : `${base}/rendered`;
}

/**
 * The DICOM StudyInstanceUID of a FHIR ImagingStudy. FHIR R4 stores it as an identifier with
 * system "urn:dicom:uid" and value "urn:oid:1.2.3..."; some servers (e.g. Synthea data) use
 * another system, so any "urn:oid:" value is accepted, the urn:dicom:uid one first.
 */
export function studyUidOf(study: ImagingStudy): string | undefined {
  const ids = study.identifier ?? [];
  const pick = ids.find((i) => i.system === "urn:dicom:uid") ?? ids.find((i) => i.value?.startsWith("urn:oid:"));
  const uid = pick?.value?.replace(/^urn:oid:/, "");
  return uid && /^[0-9]+(\.[0-9]+)*$/.test(uid) && uid.length <= 64 ? uid : undefined;
}
