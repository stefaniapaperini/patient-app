"use client";

import { useState } from "react";
import { Modal } from "./ui";

/** The project on GitHub. `blob/HEAD` always opens the default branch's current version. */
const REPO_URL = "https://github.com/stefaniapaperini/patient-app";
const DOCS = [
  {
    href: `${REPO_URL}/blob/HEAD/README.md`,
    title: "README",
    text: "What the app does, how to configure and run it, and a tour of the FHIR Inspector.",
  },
  {
    href: `${REPO_URL}/blob/HEAD/ARCHITECTURE.md`,
    title: "Architecture",
    text: "How the app is built: routes, the FHIR proxy and its security rules, data flow and how to extend it.",
  },
];

/** Header button that opens a short overview of the app with links to its documentation. */
export function OverviewButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)} aria-haspopup="dialog">
        Overview
      </button>
      {open && <OverviewDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function OverviewDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="Overview"
      onClose={onClose}
      footer={
        <div className="modal-foot overview-foot">
          <Rose />
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      <div className="modal-body">
        <p>
          Patient Management lists, searches, creates and edits patients on a FHIR R4 server, and shows each
          patient’s vital signs, conditions, medications and imaging studies. When a DICOMweb server is
          configured, it also shows their DICOM images in a simple viewer. All data stays on the FHIR and DICOM
          servers; the app stores nothing itself.
        </p>
        <p className="muted small">
          Switch on the <b>FHIR Inspector</b> in the header to see the FHIR requests and resources behind every
          part of the page, and to open the request log, the console and Learn FHIR.
        </p>

        <div>
          <h3 className="overview-h">Documentation</h3>
          <ul className="overview-links">
            {DOCS.map((d) => (
              <li key={d.href}>
                <a href={d.href} target="_blank" rel="noreferrer">
                  {d.title} ↗
                </a>
                <span className="muted small">{d.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="muted small">
          Open source under the{" "}
          <a href={`${REPO_URL}/blob/HEAD/LICENSE`} target="_blank" rel="noreferrer">
            MIT License
          </a>
          , made for learning FHIR. It is not a medical device: do not use it for clinical decisions.{" "}
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            Source code on GitHub ↗
          </a>
        </p>
      </div>
    </Modal>
  );
}

/** A small hand-drawn rose: the personal touch of this project. Decorative only. */
function Rose() {
  return (
    <svg className="overview-rose" viewBox="0 0 32 32" width="34" height="34" aria-hidden>
      {/* Laid diagonally: bloom at the top right, stem towards the bottom left. */}
      <g transform="rotate(50 16 16)">
        {/* A gently swaying stem (an S-curve), thinning towards its end, with a small thorn. */}
        <path d="M16 19.5 C14.2 22.5 18 25.5 15.6 28.2" fill="none" stroke="#1f5a2c" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M15.6 28.2 C15 28.9 14.5 29.7 14.1 30.8" fill="none" stroke="#1f5a2c" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M15.95 24.9 L14.7 25.3 L15.9 25.9 Z" fill="#1f5a2c" />
        {/* Two leaves at different heights, on either side, each with a lighter centre vein. */}
        <path d="M15.6 22.2 C13.6 19.6 10.4 19.9 9 22.4 C11.3 24.2 14 24 15.6 22.2 Z" fill="#2e7a3d" stroke="#1f5a2c" strokeWidth="0.5" />
        <path d="M15.6 22.2 C13.4 21.8 11.4 22 9.7 22.4" fill="none" stroke="#6fb07a" strokeWidth="0.5" strokeLinecap="round" />
        <path d="M16.4 26.1 C18 24 20.6 24.2 21.6 26.1 C19.8 27.6 17.7 27.5 16.4 26.1 Z" fill="#2e7a3d" stroke="#1f5a2c" strokeWidth="0.5" />
        <path d="M16.4 26.1 C18.2 25.7 19.9 25.8 21 26.1" fill="none" stroke="#6fb07a" strokeWidth="0.5" strokeLinecap="round" />
        {/* outer petals */}
        <path
          d="M7.5 10.5 C7.5 16.8 11.5 20.5 16 20.5 C20.5 20.5 24.5 16.8 24.5 10.5 C21.5 12.8 19 13 16 12 C13 13 10.5 12.8 7.5 10.5 Z"
          fill="#9e0f24"
          stroke="#5c0614"
          strokeWidth="0.6"
        />
        {/* bloom */}
        <path
          d="M10.5 9.8 C10.5 5.9 13 3.8 16 3.8 C19 3.8 21.5 5.9 21.5 9.8 C21.5 13.4 19 15.6 16 15.6 C13 15.6 10.5 13.4 10.5 9.8 Z"
          fill="#d7182f"
          stroke="#5c0614"
          strokeWidth="0.6"
        />
        {/* the spiral of the inner petals */}
        <path d="M16 7.4 C18.1 7.4 19.2 9 18.6 10.6 C18 12.1 15.7 12.4 14.8 11 C14.1 9.9 14.8 8.7 16.1 8.9" fill="none" stroke="#5c0614" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M12.2 8.6 C12.4 11.8 14 13.6 16.4 13.9" fill="none" stroke="#5c0614" strokeWidth="1" strokeLinecap="round" />
      </g>
    </svg>
  );
}
