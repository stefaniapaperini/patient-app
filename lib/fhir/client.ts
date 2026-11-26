/**
 * Browser-side FHIR client. Every call goes through the backend proxy at /api/fhir,
 * which adds the Authorization header.
 */
import type { Bundle, OperationOutcome, Resource } from "./types";

export const PROXY_BASE = "/api/fhir";

export class FhirError extends Error {
  constructor(
    message: string,
    public status: number,
    public outcome?: OperationOutcome,
  ) {
    super(message);
    this.name = "FhirError";
  }
}

/** Turns an OperationOutcome (or nothing) into a readable message. */
export function outcomeMessage(outcome: unknown, status: number, statusText = ""): string {
  const oo = outcome as OperationOutcome | undefined;
  const msgs =
    oo?.resourceType === "OperationOutcome"
      ? (oo.issue ?? [])
          .filter((i) => i.severity === "error" || i.severity === "fatal" || !i.severity)
          .map((i) => i.diagnostics || i.details?.text)
          .filter((m): m is string => !!m)
      : [];
  if (msgs.length) return msgs.join(" ");
  const generic: Record<number, string> = {
    400: "The server rejected the request as invalid.",
    401: "Not authorized. Check the FHIR token.",
    403: "Access denied.",
    404: "Not found.",
    409: "Conflict: the record was changed by someone else. Reload and try again.",
    412: "The record was changed by someone else since you opened it. Reload and try again.",
    422: "The server could not process the data (validation failed).",
    500: "The FHIR server had an internal error.",
    502: "Could not reach the FHIR server.",
    503: "The FHIR server is unavailable.",
    504: "The FHIR server timed out.",
  };
  return `${generic[status] ?? "Request failed."} (HTTP ${status}${statusText ? ` ${statusText}` : ""})`;
}

/**
 * Accepts "Patient?name=x", "/Patient/1" or an already-proxied "/api/fhir/..." URL.
 * Absolute URLs are refused: the proxy rewrites the server's links, so one that is still absolute
 * points somewhere the app must not call (and would otherwise become "/api/fhir/https://...").
 */
export function proxyUrl(path: string): string {
  if (path === PROXY_BASE || path.startsWith(PROXY_BASE + "/") || path.startsWith(PROXY_BASE + "?")) return path;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    throw new FhirError(`The FHIR server returned a link the app cannot follow: ${path}`, 0);
  }
  return `${PROXY_BASE}/${path.replace(/^\/+/, "")}`;
}

/**
 * Like fhirFetch, but also returns the response's Location header (set on create/update).
 * `body` is undefined when the server sent an empty response (e.g. it ignored
 * `Prefer: return=representation`).
 */
export async function fhirRequest<T = Resource>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<{ body: T | undefined; location: string | undefined; status: number }> {
  const { json, headers, ...rest } = init;
  const url = proxyUrl(path);
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: {
        Accept: "application/fhir+json",
        ...(json !== undefined ? { "Content-Type": "application/fhir+json" } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      cache: "no-store",
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new FhirError("Network error: could not reach the app server. Is it running?", 0);
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    throw new FhirError(outcomeMessage(body, res.status, res.statusText), res.status, body as OperationOutcome);
  }
  return { body: body as T | undefined, location: res.headers.get("location") ?? undefined, status: res.status };
}

export async function fhirFetch<T = Resource>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  return (await fhirRequest<T>(path, init)).body as T;
}

export function nextLink(bundle: Bundle): string | undefined {
  return bundle.link?.find((l) => l.relation === "next")?.url;
}

/**
 * Fetches a search and follows "next" links until the end (or maxPages).
 * Returns every entry, including _include'd resources.
 */
export async function fetchAllPages<T extends Resource = Resource>(
  path: string,
  { maxPages = 50, signal }: { maxPages?: number; signal?: AbortSignal } = {},
): Promise<{ entries: NonNullable<Bundle<T>["entry"]>; truncated: boolean }> {
  const entries: NonNullable<Bundle<T>["entry"]> = [];
  let url: string | undefined = path;
  let pages = 0;
  while (url && pages < maxPages) {
    const bundle: Bundle<T> = await fhirFetch<Bundle<T>>(url, { signal });
    entries.push(...(bundle.entry ?? []));
    url = nextLink(bundle);
    pages++;
  }
  return { entries, truncated: !!url };
}

/** Entries that matched the search (not _include'd or OperationOutcome entries). */
export function matches<T extends Resource>(entries: NonNullable<Bundle<T>["entry"]>, type: string): T[] {
  return entries
    .filter((e) => e.resource?.resourceType === type && e.search?.mode !== "include")
    .map((e) => e.resource as T);
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
