/**
 * Browser side of DICOMweb: QIDO-RS searches and WADO-RS rendered images, always through the
 * app's read-only proxy (/api/dicomweb). Results are DICOM JSON: objects keyed by tag
 * ("0020000D") with { vr, Value: [...] }.
 */
import type { ImagingStudy } from "../fhir/types";

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

/** A QIDO-RS search through the proxy. "No match" (204) is an empty list. */
export async function qido(path: string, signal?: AbortSignal): Promise<DicomJson[]> {
  const res = await fetch(`${DICOMWEB_BASE}/qido/${path}`, { signal, headers: { Accept: "application/dicom+json" } });
  if (res.status === 204) return [];
  if (!res.ok) throw new Error(await errorText(res));
  const body = await res.json();
  return Array.isArray(body) ? (body as DicomJson[]) : [];
}

const fields = (...tags: string[]) => tags.map((t) => `includefield=${t}`).join("&");

export interface DicomStudy {
  uid: string;
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
    patientId: tagText(o, TAG.PatientID),
    date: dicomDate(tagText(o, TAG.StudyDate)),
    description: tagText(o, TAG.StudyDescription),
    modalities: (o[TAG.ModalitiesInStudy]?.Value ?? []).map(String),
    seriesCount: tagNumber(o, TAG.NumberOfStudyRelatedSeries),
    instanceCount: tagNumber(o, TAG.NumberOfStudyRelatedInstances),
  };
}

/** The study with this StudyInstanceUID on the DICOM server, or undefined if it isn't there. */
export async function findStudy(uid: string, signal?: AbortSignal): Promise<DicomStudy | undefined> {
  const found = await qido(`studies?StudyInstanceUID=${encodeURIComponent(uid)}&${STUDY_FIELDS}`, signal);
  return found.map(toStudy).find((s) => s?.uid === uid);
}

/** The studies of one DICOM patient, newest first. */
export async function studiesOfPatient(dicomPatientId: string, signal?: AbortSignal): Promise<DicomStudy[]> {
  const found = await qido(`studies?PatientID=${encodeURIComponent(dicomPatientId)}&${STUDY_FIELDS}`, signal);
  return found
    .map(toStudy)
    .filter((s): s is DicomStudy => !!s && s.patientId === dicomPatientId)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

export interface DicomSeries {
  uid: string;
  number?: number;
  modality?: string;
  description?: string;
  instanceCount?: number;
}

export async function seriesOfStudy(studyUid: string, signal?: AbortSignal): Promise<DicomSeries[]> {
  const found = await qido(
    `studies/${studyUid}/series?${fields(TAG.SeriesInstanceUID, TAG.SeriesNumber, TAG.Modality, TAG.SeriesDescription, TAG.NumberOfSeriesRelatedInstances)}`,
    signal,
  );
  return found
    .map((o) => ({
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
  instanceNumber?: number;
  /** 1-based frame number, only for multi-frame instances. */
  frame?: number;
}

/** The server returns at most this many results per QIDO request. */
const QIDO_PAGE = 100;
const MAX_INSTANCES = 2000;

/** All images of a series, in instance order, expanding multi-frame instances into frames. */
export async function slicesOfSeries(studyUid: string, seriesUid: string, signal?: AbortSignal): Promise<Slice[]> {
  const instances: DicomJson[] = [];
  for (let offset = 0; offset < MAX_INSTANCES; offset += QIDO_PAGE) {
    const page = await qido(
      `studies/${studyUid}/series/${seriesUid}/instances?limit=${QIDO_PAGE}&offset=${offset}&${fields(TAG.SOPInstanceUID, TAG.InstanceNumber, TAG.NumberOfFrames)}`,
      signal,
    );
    instances.push(...page);
    if (page.length < QIDO_PAGE) break;
  }
  const seen = new Set<string>();
  const slices: Slice[] = [];
  for (const o of instances) {
    const sop = tagText(o, TAG.SOPInstanceUID);
    if (!sop || seen.has(sop)) continue;
    seen.add(sop);
    const instanceNumber = tagNumber(o, TAG.InstanceNumber);
    const frames = tagNumber(o, TAG.NumberOfFrames) ?? 1;
    if (frames > 1) for (let f = 1; f <= frames; f++) slices.push({ sop, instanceNumber, frame: f });
    else slices.push({ sop, instanceNumber });
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
