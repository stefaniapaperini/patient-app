/**
 * FHIR proxy: /api/fhir/<path>?<query>  ->  ${FHIR_BASE_URL}/<path>?<query>
 * Adds the Authorization header on the server so the token never reaches the browser.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  ConfigError,
  buildUpstreamUrl,
  operationOutcome,
  readConfig,
  rewriteBundleLinks,
  toProxyUrl,
} from "@/lib/server/proxy";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 30_000;
const FHIR_JSON = "application/fhir+json";

type Ctx = { params: Promise<{ path?: string[] }> };

function errorResponse(status: number, message: string, code?: string) {
  return NextResponse.json(operationOutcome(message, code), {
    status,
    headers: { "Content-Type": FHIR_JSON },
  });
}

async function handle(req: NextRequest, ctx: Ctx): Promise<Response> {
  let config;
  try {
    config = readConfig();
  } catch (e) {
    if (e instanceof ConfigError) return errorResponse(500, e.message, "exception");
    throw e;
  }

  const { path = [] } = await ctx.params;
  const upstream = buildUpstreamUrl(config.baseUrl, path, req.nextUrl.search);
  if (!upstream) {
    return errorResponse(403, `The proxy does not allow access to "/${path.join("/")}".`, "forbidden");
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.token}`,
    Accept: FHIR_JSON,
  };
  const ifMatch = req.headers.get("if-match");
  if (ifMatch) headers["If-Match"] = ifMatch;

  let body: string | undefined;
  if (req.method === "POST" || req.method === "PUT") {
    body = await req.text();
    headers["Content-Type"] = FHIR_JSON;
    headers["Prefer"] = "return=representation";
  }

  let res: Response;
  try {
    res = await fetch(upstream, {
      method: req.method,
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return timedOut
      ? errorResponse(504, `The FHIR server did not respond within ${TIMEOUT_MS / 1000} seconds.`, "timeout")
      : errorResponse(502, "Could not reach the FHIR server. Check FHIR_BASE_URL and your network connection.", "transient");
  }

  const outHeaders = new Headers({ "Content-Type": FHIR_JSON, "Cache-Control": "no-store" });
  for (const h of ["etag", "last-modified"]) {
    const v = res.headers.get(h);
    if (v) outHeaders.set(h, v);
  }
  const location = res.headers.get("location") ?? res.headers.get("content-location");
  if (location) outHeaders.set("Location", toProxyUrl(location, config.baseUrl));

  const text = await res.text();
  if (!text) return new Response(null, { status: res.status, headers: outHeaders });

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // Upstream sent non-JSON (e.g. an HTML error page from a gateway). Don't forward it raw.
    const snippet = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
    return errorResponse(
      res.ok ? 502 : res.status,
      `FHIR server returned HTTP ${res.status} with a non-FHIR response${snippet ? `: ${snippet}` : "."}`,
    );
  }
  if (res.status === 401 || res.status === 403) {
    // Make auth failures obvious: the browser can't fix these, only the server config can.
    const detail = (json as { issue?: { diagnostics?: string }[] })?.issue?.[0]?.diagnostics;
    return errorResponse(
      res.status,
      `The FHIR server rejected the credentials (HTTP ${res.status}). Check FHIR_TOKEN in .env.${detail ? ` Server said: ${detail}` : ""}`,
      "security",
    );
  }

  return new Response(JSON.stringify(rewriteBundleLinks(json, config.baseUrl)), {
    status: res.status,
    headers: outHeaders,
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
