/**
 * Read-only DICOMweb proxy: /api/dicomweb/qido/... -> ${DICOMWEB_QIDO_URL}/...
 *                          /api/dicomweb/wado/... -> ${DICOMWEB_WADO_URL}/...
 * Only GET, and only the QIDO-RS searches and WADO-RS rendered images the imaging viewer uses
 * (see buildDicomUpstream). /api/dicomweb itself returns whether imaging is configured and the
 * demo patient links, so the browser never needs the DICOM server's address.
 */
import { NextRequest, NextResponse } from "next/server";
import { buildDicomUpstream, DicomConfigError, readDicomConfig } from "@/lib/server/dicomweb";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 30_000;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);

type Ctx = { params: Promise<{ path?: string[] }> };

function error(status: number, message: string) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  let config;
  try {
    config = readDicomConfig();
  } catch (e) {
    if (e instanceof DicomConfigError) return error(500, e.message);
    throw e;
  }
  const { path = [] } = await ctx.params;

  if (path.length === 0) {
    return NextResponse.json(
      { enabled: !!config, demoPatients: config?.demoPatients ?? {} },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!config) return error(404, "Imaging is not configured: set DICOMWEB_QIDO_URL in .env (see .env.example).");

  const upstream = buildDicomUpstream(config, path, req.nextUrl.search);
  if (!upstream) return error(403, `The imaging proxy does not allow "/${path.join("/")}${req.nextUrl.search}".`);

  const rendered = path[0] === "wado";
  let res: Response;
  let body: ArrayBuffer;
  try {
    res = await fetch(upstream, {
      headers: { Accept: rendered ? "image/jpeg" : "application/dicom+json" },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    body = await res.arrayBuffer();
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return timedOut
      ? error(504, `The DICOM server did not respond within ${TIMEOUT_MS / 1000} seconds.`)
      : error(502, "Could not reach the DICOM server. Check DICOMWEB_QIDO_URL and your network connection.");
  }

  // QIDO-RS answers 204 with no body when nothing matches.
  if (res.status === 204) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  if (!res.ok) {
    const text = new TextDecoder().decode(body).replace(/\s+/g, " ").trim().slice(0, 200);
    return error(res.status >= 500 ? 502 : res.status, `The DICOM server returned HTTP ${res.status}${text ? `: ${text}` : "."}`);
  }

  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (rendered) {
    if (!IMAGE_TYPES.has(type)) return error(502, `The DICOM server returned ${type || "no content type"} instead of an image.`);
    // An image is addressed by its UIDs and never changes, so the browser may keep it.
    return new Response(body, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400" } });
  }
  if (type !== "application/dicom+json" && type !== "application/json") {
    return error(502, `The DICOM server returned ${type || "no content type"} instead of DICOM JSON.`);
  }
  return new Response(body, { headers: { "Content-Type": "application/dicom+json", "Cache-Control": "no-store" } });
}
