/**
 * Server-only helpers for the FHIR proxy. Never import this from client components:
 * it reads FHIR_TOKEN from the environment.
 */
import "server-only";

/** Resource types the browser is allowed to reach through the proxy. */
export const ALLOWED_RESOURCES = new Set([
  "Patient",
  "Observation",
  "Condition",
  "MedicationRequest",
  "Medication",
]);

/** A single path segment: resource type, id, or "_history"/version id. */
const SEGMENT = /^[A-Za-z0-9\-._]{1,64}$/;

export interface FhirConfig {
  baseUrl: URL;
  token: string;
}

export class ConfigError extends Error {}

export function readConfig(): FhirConfig {
  const rawBase = process.env.FHIR_BASE_URL?.trim();
  const token = process.env.FHIR_TOKEN?.trim();
  const missing = [!rawBase && "FHIR_BASE_URL", !token && "FHIR_TOKEN"].filter(Boolean);
  if (missing.length) {
    throw new ConfigError(
      `Server is not configured: missing ${missing.join(" and ")}. Set it in the .env file (see .env.example).`,
    );
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBase!.replace(/\/+$/, ""));
  } catch {
    throw new ConfigError("FHIR_BASE_URL is not a valid URL.");
  }
  if (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") {
    throw new ConfigError("FHIR_BASE_URL must start with http:// or https://");
  }
  return { baseUrl, token: token! };
}

/**
 * Validates the proxied path and returns the upstream URL, or null if the request is not allowed.
 * - Reads (GET) may reach any resource type in ALLOWED_RESOURCES.
 * - Writes are limited to what the app does: POST /Patient (create) and PUT /Patient/{id} (update).
 *   Without this, the server's token could be used to write Observations, Conditions, etc.
 * - The empty path is only allowed for reading HAPI paging links (GET ?_getpages=...): a POST or
 *   PUT to the server base would run a transaction/batch Bundle and bypass ALLOWED_RESOURCES.
 */
export function buildUpstreamUrl(method: string, base: URL, segments: string[], search: string): URL | null {
  const m = method.toUpperCase();
  if (segments.length === 0) {
    if (m !== "GET") return null;
    if (!new URLSearchParams(search).has("_getpages")) return null;
  } else {
    if (!ALLOWED_RESOURCES.has(segments[0])) return null;
    if (segments.length > 4) return null;
    if (!segments.every((s) => SEGMENT.test(s) && s !== "." && s !== "..")) return null;
    if (m === "POST" && !(segments[0] === "Patient" && segments.length === 1)) return null;
    if (m === "PUT" && !(segments[0] === "Patient" && segments.length === 2 && !segments[1].startsWith("_"))) return null;
    if (m !== "GET" && m !== "POST" && m !== "PUT") return null;
  }
  const url = new URL(base.toString());
  url.pathname = [base.pathname.replace(/\/+$/, ""), ...segments.map(encodeURIComponent)].join("/");
  url.search = search;
  return url;
}

/**
 * Rewrites an absolute URL that points at the FHIR server into a proxy-relative URL.
 * The host is not compared: servers behind reverse proxies or TLS terminators often report an
 * internal hostname, port or scheme (e.g. http://hapi:8080/fhir). That is safe because the proxy
 * only ever sends requests to FHIR_BASE_URL, whatever host a link names.
 * - A path under the base path keeps its remainder: .../fhir/T/Patient?page=2 -> /api/fhir/Patient?page=2
 * - A HAPI paging link (?_getpages=) under any path becomes /api/fhir?_getpages=...
 * Anything else (another path, not a URL) is returned unchanged.
 */
export function toProxyUrl(href: string, base: URL, proxyPrefix = "/api/fhir"): string {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return href;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return href;
  const basePath = base.pathname.replace(/\/+$/, "");
  if (u.pathname === basePath || u.pathname.startsWith(basePath + "/")) {
    return proxyPrefix + u.pathname.slice(basePath.length) + u.search;
  }
  if (u.searchParams.has("_getpages")) return proxyPrefix + u.search;
  return href;
}

/** Rewrites Bundle.link[].url so the browser can follow paging links through the proxy. */
export function rewriteBundleLinks(body: unknown, base: URL): unknown {
  if (!body || typeof body !== "object") return body;
  const b = body as { resourceType?: string; link?: { relation: string; url: string }[] };
  if (b.resourceType === "Bundle" && Array.isArray(b.link)) {
    b.link = b.link.map((l) => ({ ...l, url: toProxyUrl(l.url, base) }));
  }
  return b;
}

/**
 * Enforces ALLOWED_RESOURCES on what comes back, not only on the path: _include, _revinclude and
 * compartment searches (Patient/1/Encounter) make the server return other resource types.
 * - A Bundle keeps only entries whose resource is an allowed type or an OperationOutcome;
 *   Bundle.total still counts the matches, which are allowed types.
 * - A single resource of another type is refused: returns REFUSED.
 * - Resources embedded in an allowed one (`contained`) are deliberately left alone. In FHIR they are
 *   part of the resource that holds them and cannot be read on their own, so they belong to the
 *   allowed record. Removing them would also corrupt writes: the edit form PUTs back the Patient it
 *   read, so a stripped copy would delete the contained resources on the server.
 * JSON without a resourceType (e.g. a gateway error) is not a resource and passes unchanged.
 */
export const REFUSED = Symbol("refused");

export function filterDisallowed(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const r = body as { resourceType?: unknown; entry?: unknown };
  if (r.resourceType === "Bundle") {
    if (Array.isArray(r.entry)) {
      r.entry = r.entry.filter((e) => !e?.resource || allowedType(e.resource.resourceType));
    }
    return r;
  }
  return r.resourceType === undefined || allowedType(r.resourceType) ? r : REFUSED;
}

function allowedType(t: unknown): boolean {
  return typeof t === "string" && (ALLOWED_RESOURCES.has(t) || t === "OperationOutcome");
}


/** Builds a FHIR OperationOutcome so every proxy error has the same shape as server errors. */
export function operationOutcome(diagnostics: string, code = "processing") {
  return {
    resourceType: "OperationOutcome",
    issue: [{ severity: "error", code, diagnostics }],
  };
}
