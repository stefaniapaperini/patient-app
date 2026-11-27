"use client";

import { useState } from "react";
import { DicomViewer } from "./DicomViewer";
import { Empty, ErrorBanner, Loading } from "./ui";
import { fetchAllPages, matches } from "@/lib/fhir/client";
import { formatDate } from "@/lib/fhir/format";
import type { ImagingStudy } from "@/lib/fhir/types";
import { findStudy, imagingConfig, studiesOfPatient, studyUidOf, type DicomStudy } from "@/lib/dicom/dicomweb";
import { useAsync } from "@/lib/useAsync";

/** At most this many DICOM lookups at once (one per FHIR ImagingStudy). */
const CONCURRENCY = 4;

interface Row {
  fhir: ImagingStudy;
  uid?: string;
  /** The study on the DICOM server, if it is there. */
  dicom?: DicomStudy;
  /** The lookup failed (the DICOM server could not be reached). */
  checkFailed?: boolean;
}

/**
 * Imaging studies of a patient and a viewer for their images.
 * - FHIR ImagingStudy resources are the real link: each names a DICOM StudyInstanceUID, which is
 *   looked up on the DICOM server (QIDO-RS). Only studies found there can be viewed.
 * - A demo link (DICOM_DEMO_PATIENTS in .env) adds the studies of an example DICOM patient. They
 *   belong to another (anonymous) person and are labelled so.
 * Hidden entirely when no DICOM server is configured.
 */
export function ImagingSection({ patientId }: { patientId: string }) {
  const query = `ImagingStudy?${new URLSearchParams({ patient: patientId, _count: "200" })}`;
  const [open, setOpen] = useState<{ uid: string; title: string }>();
  const { data, loading, error, reload } = useAsync(
    async (signal) => {
      const config = await imagingConfig(signal);
      if (!config.enabled) return { enabled: false as const };

      const { entries } = await fetchAllPages<ImagingStudy>(query, { signal });
      const studies = matches<ImagingStudy>(entries, "ImagingStudy").sort((a, b) =>
        (b.started ?? "").localeCompare(a.started ?? ""),
      );
      const rows: Row[] = studies.map((fhir) => ({ fhir, uid: studyUidOf(fhir) }));
      for (let i = 0; i < rows.length; i += CONCURRENCY) {
        await Promise.all(
          rows.slice(i, i + CONCURRENCY).map(async (row) => {
            if (!row.uid) return;
            try {
              row.dicom = await findStudy(row.uid, signal);
            } catch (e) {
              if (signal.aborted) throw e;
              row.checkFailed = true;
            }
          }),
        );
      }

      const demoPatient = config.demoPatients[patientId];
      let demo: DicomStudy[] = [];
      let demoError: string | undefined;
      if (demoPatient) {
        try {
          demo = await studiesOfPatient(demoPatient, signal);
        } catch (e) {
          if (signal.aborted) throw e;
          demoError = e instanceof Error ? e.message : String(e);
        }
      }
      return { enabled: true as const, rows, demoPatient, demo, demoError };
    },
    [patientId],
  );

  if (data && !data.enabled) return null;

  const view = (uid: string, title: string) => setOpen(open?.uid === uid ? undefined : { uid, title });
  const anyFailed = data?.enabled && data.rows.some((r) => r.checkFailed);

  return (
    <section className="card" aria-labelledby="img-h">
      <div className="card-header">
        <h2 id="img-h">Imaging</h2>
      </div>
      {loading && !data ? (
        <Loading label="Loading imaging studies…" />
      ) : error ? (
        <ErrorBanner title="Could not load imaging studies" message={error} onRetry={reload} />
      ) : data?.enabled ? (
        <>
          {anyFailed && (
            <ErrorBanner
              title="The DICOM server could not be reached"
              message="Some studies could not be checked for images."
              onRetry={reload}
            />
          )}
          {data.rows.length === 0 && !data.demoPatient ? (
            <Empty>No imaging studies recorded for this patient.</Empty>
          ) : data.rows.length > 0 ? (
            <div className="table-wrap scroll-md">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Description</th>
                    <th className="num">Images</th>
                    <th>On the DICOM server</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => {
                    const title = fhirTitle(r.fhir);
                    return (
                      <tr key={r.fhir.id ?? i}>
                        <td className="num">{formatDate(r.fhir.started)}</td>
                        <td>{fhirModalities(r.fhir)}</td>
                        <td className="wrap">{title}</td>
                        <td className="num">{r.fhir.numberOfInstances ?? "—"}</td>
                        <td>
                          {r.dicom ? (
                            <button type="button" className="btn btn-sm" onClick={() => view(r.dicom!.uid, title)} aria-expanded={open?.uid === r.dicom.uid}>
                              {open?.uid === r.dicom.uid ? "Hide images" : "View images"}
                            </button>
                          ) : (
                            <span className="muted small">
                              {r.checkFailed ? "Could not check" : r.uid ? "Not available" : "No DICOM study ID"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          {data.rows.length > 0 && data.rows.every((r) => !r.dicom && !r.checkFailed) && (
            <p className="small muted imaging-note">
              The images of these studies are not on the DICOM server, so they cannot be shown.
            </p>
          )}

          {data.demoPatient && (
            <div className="imaging-demo">
              <h3>
                Demo images <span className="badge badge-warn">not this patient</span>
              </h3>
              <p className="small muted">
                These images belong to the anonymous example patient <code>{data.demoPatient}</code> on the public DICOM
                server. They are linked to this patient only to demonstrate the viewer (DICOM_DEMO_PATIENTS in .env).
              </p>
              {data.demoError ? (
                <ErrorBanner title="Could not load the demo images" message={data.demoError} onRetry={reload} />
              ) : data.demo.length === 0 ? (
                <Empty>The DICOM server has no studies for {data.demoPatient}.</Empty>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Description</th>
                        <th className="num">Images</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.demo.map((s) => {
                        const title = `Demo: ${s.description || s.modalities.join(", ") || "study"} (${data.demoPatient})`;
                        return (
                          <tr key={s.uid}>
                            <td className="num">{formatDate(s.date)}</td>
                            <td>{s.modalities.join(", ") || "—"}</td>
                            <td className="wrap">{s.description || "—"}</td>
                            <td className="num">{s.instanceCount ?? "—"}</td>
                            <td>
                              <button type="button" className="btn btn-sm" onClick={() => view(s.uid, title)} aria-expanded={open?.uid === s.uid}>
                                {open?.uid === s.uid ? "Hide images" : "View images"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {open && <DicomViewer key={open.uid} studyUid={open.uid} title={open.title} onClose={() => setOpen(undefined)} />}
        </>
      ) : null}
    </section>
  );
}

function fhirModalities(s: ImagingStudy): string {
  const codes = [...(s.modality ?? []), ...(s.series ?? []).map((x) => x.modality).filter((m) => !!m)]
    .map((m) => m!.code)
    .filter((c): c is string => !!c);
  return [...new Set(codes)].join(", ") || "—";
}

function fhirTitle(s: ImagingStudy): string {
  return (
    s.description ||
    s.procedureCode?.[0]?.text ||
    s.procedureCode?.[0]?.coding?.[0]?.display ||
    s.series?.[0]?.bodySite?.display ||
    s.series?.[0]?.modality?.display ||
    "Imaging study"
  );
}
