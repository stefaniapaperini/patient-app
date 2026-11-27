/**
 * Server-only helpers for the read-only DICOMweb proxy (/api/dicomweb/...). Like the FHIR proxy,
 * it keeps the DICOM server's address in .env and only lets through the requests the imaging
 * viewer makes: QIDO-RS searches and WADO-RS rendered images. No uploads (STOW-RS), no deletes.
 */
import "server-only";

export interface DicomConfig {
  /** QIDO-RS (search) root, e.g. https://dicomserver.co.uk:8989/qido */
  qido: URL;
  /** WADO-RS (retrieve) root, e.g. https://dicomserver.co.uk:8989/wado */
  wado: URL;
  /** Demo links: FHIR Patient id -> DICOM PatientID of an example patient on the DICOM server. */
  demoPatients: Record<string, string>;
}

export class DicomConfigError extends Error {}

function rootUrl(raw: string, name: string): URL {
  let u: URL;
  try {
    u = new URL(raw.replace(/\/+$/, ""));
  } catch {
    throw new DicomConfigError(`${name} is not a valid URL.`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new DicomConfigError(`${name} must start with http:// or https://`);
  return u;
}

/**
 * "fhirId:DICOM_PATIENT_ID,fhirId2:ID2" -> { fhirId: "DICOM_PATIENT_ID", ... }. Entries that are not
 * "id:id" are ignored, so a typo disables one link rather than the whole viewer.
 */
export function parseDemoPatients(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of (raw ?? "").split(",")) {
    const i = item.indexOf(":");
    if (i <= 0) continue;
    const fhirId = item.slice(0, i).trim();
    const dicomId = item.slice(i + 1).trim();
    if (/^[A-Za-z0-9\-.]{1,64}$/.test(fhirId) && /^[^\\*?,=&]{1,64}$/.test(dicomId)) out[fhirId] = dicomId;
  }
  return out;
}

/**
 * The DICOMweb settings, or null when imaging is not configured (DICOMWEB_QIDO_URL unset): the
 * app then hides the imaging section. Servers with one DICOMweb root for everything only need
 * DICOMWEB_QIDO_URL; WADO-RS defaults to the same root.
 */
export function readDicomConfig(): DicomConfig | null {
  const qido = process.env.DICOMWEB_QIDO_URL?.trim();
  if (!qido) return null;
  const wado = process.env.DICOMWEB_WADO_URL?.trim() || qido;
  return {
    qido: rootUrl(qido, "DICOMWEB_QIDO_URL"),
    wado: rootUrl(wado, "DICOMWEB_WADO_URL"),
    demoPatients: parseDemoPatients(process.env.DICOM_DEMO_PATIENTS),
  };
}

/** A DICOM UID: digits separated by dots, at most 64 characters. */
const UID = /^[0-9]+(\.[0-9]+)*$/;
const isUid = (s: string | undefined) => !!s && s.length <= 64 && UID.test(s);

/** QIDO-RS query parameters the viewer uses. Anything else is refused. */
const QIDO_PARAMS = new Set(["PatientID", "StudyInstanceUID", "includefield", "limit", "offset"]);

/**
 * The upstream URL for an allowed request, or null if it is not allowed. Only GET is routed here.
 * - qido/studies
 *   qido/studies/{study}/series
 *   qido/studies/{study}/series/{series}/instances
 * - wado/studies/{study}/series/{series}/instances/{instance}/rendered
 *   wado/studies/{study}/series/{series}/instances/{instance}/frames/{n}/rendered
 */
export function buildDicomUpstream(config: DicomConfig, segments: string[], search: string): URL | null {
  const [service, ...rest] = segments;
  const s = rest;
  let root: URL;
  if (service === "qido") {
    const ok =
      (s.length === 1 && s[0] === "studies") ||
      (s.length === 3 && s[0] === "studies" && isUid(s[1]) && s[2] === "series") ||
      (s.length === 5 && s[0] === "studies" && isUid(s[1]) && s[2] === "series" && isUid(s[3]) && s[4] === "instances");
    if (!ok) return null;
    const params = new URLSearchParams(search);
    for (const [name, value] of params) {
      if (!QIDO_PARAMS.has(name) || value.length > 128) return null;
      if ((name === "limit" || name === "offset") && !/^[0-9]{1,5}$/.test(value)) return null;
      if (name === "StudyInstanceUID" && !isUid(value)) return null;
      // A patient lookup matches one PatientID exactly: no wildcards. Searches without a filter are
      // allowed on purpose (Learn's examples list a few studies): the server is public, with
      // anonymous test data, and returns at most a page of results per request.
      if (name === "PatientID" && /[*?\\]/.test(value)) return null;
      if (name === "includefield" && !/^([0-9A-Fa-f]{8}|all)$/.test(value)) return null;
    }
    root = config.qido;
  } else if (service === "wado") {
    const base =
      s.length >= 7 && s[0] === "studies" && isUid(s[1]) && s[2] === "series" && isUid(s[3]) && s[4] === "instances" && isUid(s[5]);
    const ok =
      base &&
      ((s.length === 7 && s[6] === "rendered") ||
        (s.length === 9 && s[6] === "frames" && /^[1-9][0-9]{0,4}$/.test(s[7]) && s[8] === "rendered"));
    if (!ok || search.replace(/^\?/, "") !== "") return null;
    root = config.wado;
  } else {
    return null;
  }
  const url = new URL(root.toString());
  url.pathname = [root.pathname.replace(/\/+$/, ""), ...s.map(encodeURIComponent)].join("/");
  url.search = service === "qido" ? search : "";
  return url;
}
