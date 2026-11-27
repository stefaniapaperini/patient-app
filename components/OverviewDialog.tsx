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
        <div className="modal-foot">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      <div className="modal-body">
        <p>
          Patient Management lists, searches, creates and edits patients on a FHIR R4 server, and shows each
          patient’s vital signs, conditions and medications. All data stays on the FHIR server; the app stores
          nothing itself.
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
