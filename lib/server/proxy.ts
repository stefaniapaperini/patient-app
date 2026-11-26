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
 * Validates the proxied path and returns the upstream URL, or null if the path is not allowed.
 * The empty path is only allowed for reading HAPI paging links (GET ?_getpages=...): a POST or
 * PUT to the server base would run a transaction/batch Bundle and bypass ALLOWED_RESOURCES.
 */
export function buildUpstreamUrl(method: string, base: URL, segments: string[], search: string): URL | null {
  if (segments.length === 0) {
    if (method.toUpperCase() !== "GET") return null;
    if (!new URLSearchParams(search).has("_getpages")) return null;
  } else {
    if (!ALLOWED_RESOURCES.has(segments[0])) return null;
    if (segments.length > 4) return null;
    if (!segments.every((s) => SEGMENT.test(s) && s !== "." && s !== "..")) return null;
  }
  const url = new URL(base.toString());
  url.pathname = [base.pathname.replace(/\/+$/, ""), ...segments.map(encodeURIComponent)].join("/");
  url.search = search;
  return url;
}

/**
 * Rewrites an absolute URL that points at the FHIR server (either http or https, since
 * servers behind TLS terminators often report http) into a proxy-relative URL.
 * URLs that point anywhere else are returned unchanged.
 */
export function toProxyUrl(href: string, base: URL, proxyPrefix = "/api/fhir"): string {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return href;
  }
  const basePath = base.pathname.replace(/\/+$/, "");
  if (u.host !== base.host) return href;
  if (u.pathname !== basePath && !u.pathname.startsWith(basePath + "/")) return href;
  return proxyPrefix + u.pathname.slice(basePath.length) + u.search;
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

/** Builds a FHIR OperationOutcome so every proxy error has the same shape as server errors. */
export function operationOutcome(diagnostics: string, code = "processing") {
  return {
    resourceType: "OperationOutcome",
    issue: [{ severity: "error", code, diagnostics }],
  };
}
