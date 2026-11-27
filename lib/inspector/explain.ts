/** Turns a FHIR request URL into parts a person can read, and builds a curl command for it. */
import { codeMeaning, DICOM_PARAMS, DICOM_TAGS, dicomTagNotation, MODIFIERS, PARAMS } from "./glossary";

export interface ExplainedParam {
  /** As written in the URL, e.g. "name:contains". */
  name: string;
  base: string;
  modifier?: string;
  value: string;
  text: string;
  /** Meanings of the comma-separated values, when known (e.g. LOINC codes). */
  values?: { value: string; meaning?: string }[];
}

export interface ExplainedRequest {
  method: string;
  /** The path after the server base, e.g. "Patient/123" or "Observation". Empty for paging links. */
  path: string;
  resourceType?: string;
  id?: string;
  interaction: string;
  params: ExplainedParam[];
}

const PROXY_PREFIX = "/api/fhir";

/** "/api/fhir/Patient?x=1" or "Patient?x=1" -> { path: "Patient", query: "x=1" } */
export function splitUrl(url: string): { path: string; query: string } {
  let u = url.startsWith(PROXY_PREFIX) ? url.slice(PROXY_PREFIX.length) : url;
  u = u.replace(/^\/+/, "");
  const q = u.indexOf("?");
  return q < 0 ? { path: u, query: "" } : { path: u.slice(0, q), query: u.slice(q + 1) };
}

function interactionFor(method: string, segments: string[], params: URLSearchParams): string {
  if (segments.length === 0) return params.has("_getpages") ? "Next page of an earlier search" : "Server base";
  const [, id, op] = segments;
  if (method === "POST" && !id) return "Create: the server assigns a new id";
  if (method === "PUT" && id) return "Update: replaces the whole resource with the one sent";
  if (method === "GET" && (id === "_history" || op === "_history")) return "History of versions";
  if (method === "GET" && id) return "Read one resource by its id";
  if (method === "GET") return "Search: returns a Bundle of matches";
  return method;
}

export function explainRequest(method: string, url: string): ExplainedRequest {
  const { path, query } = splitUrl(url);
  const segments = path.split("/").filter(Boolean);
  const params = new URLSearchParams(query);
  const m = method.toUpperCase();
  const out: ExplainedParam[] = [];
  for (const [name, value] of params) {
    const [base, modifier] = name.split(":");
    const parts = [PARAMS[base] ?? `Search parameter “${base}”. See the resource’s search parameters in the FHIR specification.`];
    if (modifier) parts.push(MODIFIERS[modifier] ?? `Modifier “:${modifier}”.`);
    const p: ExplainedParam = { name, base, modifier, value, text: parts.join(" ") };
    if (base === "code" || base === "clinical-status" || base === "status") {
      p.values = value.split(",").map((v) => {
        const code = v.includes("|") ? v.split("|")[1] : v;
        return { value: v, meaning: codeMeaning(code) };
      });
    }
    out.push(p);
  }
  return {
    method: m,
    path,
    resourceType: segments[0],
    id: segments[1] && !segments[1].startsWith("_") ? segments[1] : undefined,
    interaction: interactionFor(m, segments, params),
    params: out,
  };
}

/** Quotes text for a POSIX shell: inside single quotes nothing is expanded ($, `, \, "). */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * A curl command that runs the same request directly against the FHIR server. The real base URL
 * and token are not known in the browser (and must not be): the command uses $FHIR_BASE_URL and
 * $FHIR_TOKEN, which `set -a; source .env; set +a` puts in the shell.
 *
 * Only those two variables are expanded. The path, query and body come from the page (and can be
 * typed into the console or arrive in a link), so they are single-quoted: a URL containing
 * $(…) or backticks must not run anything when the command is pasted into a terminal.
 */
export function toCurl(method: string, url: string, body?: unknown): string {
  const { path, query } = splitUrl(url);
  const rest = `${path ? `/${path}` : ""}${query ? `?${query}` : ""}`;
  const m = method.toUpperCase().replace(/[^A-Z]/g, "");
  const lines = [
    `curl -X ${m} "$FHIR_BASE_URL"${rest ? shellQuote(rest) : ""}`,
    `  -H "Authorization: Bearer $FHIR_TOKEN"`,
    `  -H "Accept: application/fhir+json"`,
  ];
  if (body !== undefined) {
    lines.push(`  -H "Content-Type: application/fhir+json"`, `  --data ${shellQuote(JSON.stringify(body))}`);
  }
  return lines.join(" \\\n");
}

// --- DICOMweb ------------------------------------------------------------------------------

const DICOM_PREFIX = "/api/dicomweb/";

/** Is this a request to the app's DICOMweb proxy (rather than the FHIR proxy)? */
export function isDicomUrl(url: string): boolean {
  return url.startsWith(DICOM_PREFIX);
}

export interface ExplainedDicomRequest {
  /** "QIDO-RS" (search) or "WADO-RS" (retrieve). */
  service: "QIDO-RS" | "WADO-RS";
  interaction: string;
  /** The level searched or retrieved: studies, series, instances. */
  level?: string;
  uids: { label: string; tag: string; value: string }[];
  params: ExplainedParam[];
}

/** "/api/dicomweb/qido/studies?x" -> { service: "qido", path: "studies", query: "x" } */
function splitDicom(url: string): { service: string; path: string; query: string } {
  const u = url.slice(DICOM_PREFIX.length);
  const q = u.indexOf("?");
  const rest = q < 0 ? u : u.slice(0, q);
  const [service, ...path] = rest.split("/");
  return { service, path: path.join("/"), query: q < 0 ? "" : u.slice(q + 1) };
}

/** "/api/dicomweb/qido/studies?x" -> "[QIDO-RS]/studies?x" (decoded, for reading). */
export function dicomDisplayUrl(url: string): string {
  const { service, path, query } = splitDicom(url);
  let q = query;
  try {
    q = decodeURIComponent(query.replace(/\+/g, " "));
  } catch {
    // keep it encoded
  }
  return `[${service === "wado" ? "WADO-RS" : "QIDO-RS"}]/${path}${q ? "?" + q : ""}`;
}

export function explainDicomRequest(url: string): ExplainedDicomRequest {
  const { service, path, query } = splitDicom(url);
  const s = path.split("/");
  const uids: ExplainedDicomRequest["uids"] = [];
  if (s[1]) uids.push({ label: "Study", tag: "0020000D", value: s[1] });
  if (s[3]) uids.push({ label: "Series", tag: "0020000E", value: s[3] });
  if (s[5]) uids.push({ label: "Instance", tag: "00080018", value: s[5] });
  const params: ExplainedParam[] = [];
  for (const [name, value] of new URLSearchParams(query)) {
    let text = DICOM_PARAMS[name] ?? `Query parameter “${name}”.`;
    if (name === "includefield") {
      const t = DICOM_TAGS[value.toUpperCase()];
      text = t ? `Also return ${dicomTagNotation(value)} ${t.name}: ${t.text}` : `${text} Tag ${dicomTagNotation(value)}.`;
    }
    params.push({ name, base: name, value, text });
  }
  if (service === "wado") {
    const frame = s[6] === "frames" ? s[7] : undefined;
    return {
      service: "WADO-RS",
      interaction: frame
        ? `Retrieve frame ${frame} of one image, rendered by the server as JPEG`
        : "Retrieve one image, rendered by the server as JPEG (not the original DICOM file)",
      level: "instance",
      uids,
      params,
    };
  }
  const level = s[s.length - 1];
  const scope = s.length === 1 ? "on the whole server" : s.length === 3 ? "of one study" : "of one series";
  return {
    service: "QIDO-RS",
    interaction: `Search for ${level} ${scope}: returns a list of matches in DICOM JSON`,
    level,
    uids,
    params,
  };
}

/**
 * A curl command for the same DICOMweb request, sent directly to the DICOM server. The browser
 * doesn't know its address: the command uses $DICOMWEB_QIDO_URL / $DICOMWEB_WADO_URL from .env.
 * The path and query are single-quoted, as in toCurl.
 */
export function toDicomCurl(url: string): string {
  const { service, path, query } = splitDicom(url);
  const variable = service === "wado" ? "$DICOMWEB_WADO_URL" : "$DICOMWEB_QIDO_URL";
  const rest = `/${path}${query ? `?${query}` : ""}`;
  const lines = [`curl "${variable}"${shellQuote(rest)}`];
  if (service === "wado") lines.push(`  -H "Accept: image/jpeg" -o image.jpg`);
  else lines.push(`  -H "Accept: application/dicom+json"`);
  return lines.join(" \\\n");
}

