/** Turns a FHIR request URL into parts a person can read, and builds a curl command for it. */
import { codeMeaning, MODIFIERS, PARAMS } from "./glossary";

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

/**
 * A curl command that runs the same request directly against the FHIR server. The real base URL
 * and token are not known in the browser (and must not be): the command uses $FHIR_BASE_URL and
 * $FHIR_TOKEN, which `set -a; source .env; set +a` puts in the shell.
 */
export function toCurl(method: string, url: string, body?: unknown): string {
  const { path, query } = splitUrl(url);
  const target = `$FHIR_BASE_URL${path ? `/${path}` : ""}${query ? `?${query}` : ""}`;
  const lines = [`curl -X ${method.toUpperCase()} "${target}"`, `  -H "Authorization: Bearer $FHIR_TOKEN"`, `  -H "Accept: application/fhir+json"`];
  if (body !== undefined) {
    const json = JSON.stringify(body).replace(/'/g, `'\\''`);
    lines.push(`  -H "Content-Type: application/fhir+json"`, `  --data '${json}'`);
  }
  return lines.join(" \\\n");
}
