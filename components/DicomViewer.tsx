"use client";

import { useEffect, useRef, useState } from "react";
import { InspectButton, inspectable } from "./inspector/Inspect";
import { Empty, ErrorBanner, Loading } from "./ui";
import {
  instancesUrl,
  renderedUrl,
  seriesOfStudy,
  seriesUrl,
  slicesOfSeries,
  type DicomSeries,
  type Slice,
} from "@/lib/dicom/dicomweb";
import { useInspectorEnabled, type InspectTarget } from "@/lib/inspector/store";
import { useAsync } from "@/lib/useAsync";

/** Images kept loading ahead and behind the current one, so stepping through them is smooth. */
const PRELOAD = 3;

/**
 * Shows one DICOM study: pick a series, then step through its images with the slider, the
 * buttons, the mouse wheel or the arrow keys. Images are rendered to JPEG by the DICOM server
 * (WADO-RS /rendered), so they use the server's default contrast: fine for viewing, not for diagnosis.
 */
export function DicomViewer({ studyUid, title, onClose }: { studyUid: string; title: string; onClose: () => void }) {
  const series = useAsync((signal) => seriesOfStudy(studyUid, signal), [studyUid]);
  const [seriesUid, setSeriesUid] = useState<string>();
  const current = series.data?.find((s) => s.uid === seriesUid) ?? series.data?.[0];

  return (
    <section className="viewer" aria-label={`Images of ${title}`}>
      <div className="viewer-head">
        <h3>{title}</h3>
        {series.data && series.data.length > 1 && (
          <label className="viewer-series">
            Series{" "}
            <select className="input" value={current?.uid} onChange={(e) => setSeriesUid(e.target.value)}>
              {series.data.map((s) => (
                <option key={s.uid} value={s.uid}>
                  {[s.number !== undefined ? `#${s.number}` : undefined, s.modality, s.description, s.instanceCount !== undefined ? `${s.instanceCount} images` : undefined]
                    .filter(Boolean)
                    .join(" · ")}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="btn btn-sm" onClick={onClose}>
          Close viewer
        </button>
      </div>
      {series.loading && !series.data ? (
        <Loading label="Loading series…" />
      ) : series.error ? (
        <ErrorBanner title="Could not load the series" message={series.error} onRetry={series.reload} />
      ) : !current ? (
        <Empty>This study has no series on the DICOM server.</Empty>
      ) : (
        <SeriesImages key={current.uid} studyUid={studyUid} series={current} />
      )}
    </section>
  );
}

function SeriesImages({ studyUid, series }: { studyUid: string; series: DicomSeries }) {
  const seriesUid = series.uid;
  const modality = series.modality;
  const inspecting = useInspectorEnabled();
  const expected = series.instanceCount;
  const slices = useAsync((signal) => slicesOfSeries(studyUid, seriesUid, signal, expected), [studyUid, seriesUid, expected]);
  const list = slices.data ?? [];
  const [index, setIndex] = useState(0);
  /** Load state of one image URL: a state for an earlier URL means the current one is still loading. */
  const [loaded, setLoaded] = useState<{ src: string; ok: boolean }>();
  const frameRef = useRef<HTMLDivElement>(null);
  const count = list.length;
  const at = Math.min(index, Math.max(count - 1, 0));
  const slice: Slice | undefined = list[at];
  const src = slice ? renderedUrl(studyUid, seriesUid, slice) : undefined;
  const imageState = !loaded || loaded.src !== src ? "loading" : loaded.ok ? "ready" : "error";

  const step = (delta: number) => setIndex((i) => Math.max(0, Math.min(count - 1, i + delta)));

  // Mouse wheel steps through the images. React's onWheel is passive, so preventDefault (keeping
  // the page from scrolling) needs a listener added by hand.
  useEffect(() => {
    const el = frameRef.current;
    if (!el || count < 2) return;
    const onWheel = (e: WheelEvent) => {
      // Only vertical scrolling steps through the images; a sideways swipe (deltaY 0) is left alone.
      if (e.deltaY === 0) return;
      e.preventDefault();
      setIndex((i) => Math.max(0, Math.min(count - 1, i + Math.sign(e.deltaY))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [count]);

  // Load the neighbouring images in the background.
  useEffect(() => {
    for (let d = -PRELOAD; d <= PRELOAD; d++) {
      const s = list[at + d];
      if (d !== 0 && s) new Image().src = renderedUrl(studyUid, seriesUid, s);
    }
  }, [at, list, studyUid, seriesUid]);

  if (slices.loading && !slices.data) return <Loading label="Loading images…" />;
  if (slices.error) return <ErrorBanner title="Could not load the images" message={slices.error} onRetry={slices.reload} />;
  if (count === 0 || !src) return <Empty>This series has no images.</Empty>;

  const label = `${modality ?? "Image"} ${at + 1} of ${count}`;
  const target = (): InspectTarget => ({
    title: `Image ${at + 1} of ${count}`,
    description:
      "The viewer asked the DICOM server for the study’s series, then for the series’ images (instances, at most 100 per request), all with QIDO-RS. Each image is then fetched with WADO-RS /rendered: the server converts it from DICOM to a JPEG the browser can show.",
    requests: [seriesUrl(studyUid), instancesUrl(studyUid, seriesUid)],
    dicom: [
      { label: "This series", json: series.raw },
      ...(slice.raw ? [{ label: slice.frame ? `This image (frame ${slice.frame} of the instance)` : "This image (instance)", json: slice.raw }] : []),
    ],
    image: { url: src, alt: label },
  });
  return (
    <div className="viewer-body">
      <div
        className="viewer-frame"
        ref={frameRef}
        {...inspectable(inspecting, target)}
        tabIndex={0}
        aria-label={`${label}. Use the arrow keys or the mouse wheel to change image.`}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowRight") step(1);
          else if (e.key === "ArrowUp" || e.key === "ArrowLeft") step(-1);
          else if (e.key === "Home") setIndex(0);
          else if (e.key === "End") setIndex(count - 1);
          else return;
          e.preventDefault();
        }}
      >
        {/* A plain img: the proxy serves a JPEG rendered by the DICOM server; next/image would only re-encode it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={label}
          onLoad={() => setLoaded({ src, ok: true })}
          onError={() => setLoaded({ src, ok: false })}
          className={imageState === "ready" ? "" : "viewer-img-pending"}
        />
        {imageState === "loading" && <span className="spinner viewer-spinner" aria-hidden />}
        {imageState === "error" && <div className="viewer-error">This image could not be loaded from the DICOM server.</div>}
      </div>
      {count > 1 && (
        <div className="viewer-controls">
          <button type="button" className="btn btn-sm" onClick={() => step(-1)} disabled={at === 0} aria-label="Previous image">
            ‹
          </button>
          <input
            type="range"
            min={1}
            max={count}
            value={at + 1}
            onChange={(e) => setIndex(Number(e.target.value) - 1)}
            aria-label="Image"
            aria-valuetext={label}
          />
          <button type="button" className="btn btn-sm" onClick={() => step(1)} disabled={at === count - 1} aria-label="Next image">
            ›
          </button>
          <span className="small muted viewer-count">
            {at + 1} / {count}
          </span>
          <InspectButton enabled={inspecting} target={target} label={label} />
        </div>
      )}
      <p className="small muted">
        {count === 1 && <InspectButton enabled={inspecting} target={target} label={label} />}
        Rendered as JPEG by the DICOM server with its default contrast: for viewing and learning, not for diagnosis.
        {count > 1 && " Scroll with the mouse wheel or the arrow keys over the image."}
      </p>
    </div>
  );
}
