"use client";

import Link from "next/link";
import { useState } from "react";
import { patientStudiesUrl, qido, DICOMWEB_BASE } from "@/lib/dicom/dicomweb";
import { DICOM_DICTIONARY, DICOM_PART18, DICOMWEB_SPEC, IHE_MADO, SEARCH_SPEC, SNOMED_BROWSER, specUrl } from "@/lib/inspector/glossary";
import { getInspectorState, openPanel } from "@/lib/inspector/store";

const tryIt = (url: string, method = "GET") => `/console?${new URLSearchParams({ method, url })}`;

function Try({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={tryIt(url)}>{children}</Link> <code className="small">{url}</code>
    </li>
  );
}

/**
 * A DICOMweb example: the console only sends FHIR requests, so this runs the request through the
 * app's DICOMweb proxy and opens it in the request log, with its explanation and response.
 */
function DicomTry({ url, children }: { url: string; children: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    await qido(url).catch(() => undefined); // errors are shown in the log entry
    setBusy(false);
    const entry = [...getInspectorState().log].reverse().find((e) => e.url === url);
    openPanel("log", entry?.id ?? null);
  };
  return (
    <li>
      <button type="button" className="btn btn-link" onClick={run} disabled={busy}>
        {children}
      </button>{" "}
      <code className="small">{url.replace(`${DICOMWEB_BASE}/qido`, "[QIDO-RS]")}</code>
    </li>
  );
}

/** FHIR and DICOM basics, in the order you meet them in this app, with examples to run. */
export function LearnTab() {
  return (
    <div className="learn">
      <section>
        <h3>1. Resources</h3>
        <p>
          FHIR stores health data as <b>resources</b>: small JSON documents of a fixed type, each with an <code>id</code>.
          This app uses six types:
        </p>
        <ul>
          <li>
            <a href={specUrl("Patient")} target="_blank" rel="noreferrer">Patient</a>: name, gender, date of birth, contacts.
          </li>
          <li>
            <a href={specUrl("Observation")} target="_blank" rel="noreferrer">Observation</a>: one measurement, such as a
            heart rate. The vital-sign charts are built from these.
          </li>
          <li>
            <a href={specUrl("Condition")} target="_blank" rel="noreferrer">Condition</a>: a diagnosis or problem.
          </li>
          <li>
            <a href={specUrl("MedicationRequest")} target="_blank" rel="noreferrer">MedicationRequest</a>: a prescription.
          </li>
          <li>
            <a href={specUrl("Medication")} target="_blank" rel="noreferrer">Medication</a>: a medicine, when a
            prescription refers to it instead of naming it inline.
          </li>
          <li>
            <a href={specUrl("ImagingStudy")} target="_blank" rel="noreferrer">ImagingStudy</a>: an imaging examination,
            pointing to its DICOM images (see sections 7 to 9).
          </li>
        </ul>
      </section>

      <section>
        <h3>2. References</h3>
        <p>
          Resources point to each other with references: an Observation’s <code>subject</code> is{" "}
          <code>{"{ \"reference\": \"Patient/123\" }"}</code>. That is how the app finds a patient’s data: it searches
          for Observations whose subject is that patient.
        </p>
      </section>

      <section>
        <h3>3. Codes</h3>
        <p>
          <i>What</i> a resource is about is written as codes from a code system, not as free text. A{" "}
          <code>CodeableConcept</code> holds one or more <code>coding</code>s, each a <code>system</code> plus a{" "}
          <code>code</code> (and a <code>display</code> for people):
        </p>
        <ul>
          <li><b>LOINC</b> (http://loinc.org) for measurements: <code>8867-4</code> is heart rate.</li>
          <li><b>SNOMED CT</b> (http://snomed.info/sct) for diagnoses, findings, procedures and body parts.</li>
          <li><b>RxNorm</b> for medicines.</li>
        </ul>
        <p>
          <b>SNOMED CT</b> is the largest clinical terminology, with several hundred thousand <b>concepts</b>. Each
          concept is one clinical idea with a numeric id: <code>241046008</code> is a dental bitewing X-ray. The id
          is what computers compare; the words are only for people. A concept has:
        </p>
        <ul>
          <li>
            a <b>fully specified name</b> that ends with its kind in brackets, the <i>semantic tag</i>:{" "}
            <code>Dental plain X-ray bitewing (procedure)</code>. The tag tells apart concepts with similar words:{" "}
            <code>(disorder)</code> is a disease, <code>(finding)</code> something observed,{" "}
            <code>(procedure)</code> something done, <code>(body structure)</code> a part of the body;
          </li>
          <li>
            <b>synonyms</b>, other names for the same concept, without the tag. So two resources can show
            different text for the same code: compare the codes, not the words;
          </li>
          <li>
            a place in a <b>hierarchy</b>: each concept <i>is a</i> kind of more general ones (a bitewing is a
            kind of dental X-ray). That lets a system find, for example, every kind of X-ray at once.
          </li>
        </ul>
        <p>
          The <code>display</code> in a coding is the name the sender chose; Synthea, which generated this data,
          uses the fully specified name, tag included. In the inspector, SNOMED CT codes link to the{" "}
          <a href={SNOMED_BROWSER} target="_blank" rel="noreferrer">SNOMED CT browser</a>, which shows a concept’s
          names and hierarchy.
        </p>
        <p>
          The charts search by code. If the server stores temperature under a code the app doesn’t ask for, or
          doesn’t store it at all, the chart is empty. The inspector’s “Why is this empty?” check tells the two apart.
        </p>
      </section>

      <section>
        <h3>4. Searching</h3>
        <p>
          A search is <code>GET [base]/Type?param=value</code>. The answer is a <b>Bundle</b> of matches, one page
          at a time: <code>_count</code> sets the page size, and <code>Bundle.link</code> “next” points to the next
          page. A comma means OR (<code>code=8867-4,8310-5</code>); repeating a parameter means AND. Modifiers change
          how a value matches (<code>name:contains</code>). See the{" "}
          <a href={SEARCH_SPEC} target="_blank" rel="noreferrer">search specification</a>.
        </p>
        <p className="small">Try these in the console:</p>
        <ul className="small">
          <Try url="Patient?_count=5">Five patients</Try>
          <Try url="Patient?name=wil">Name starting with “wil”</Try>
          <Try url="Patient?name:contains=rit">Name containing “rit” (this server refuses: 405)</Try>
          <Try url="Observation?code=8867-4&_count=5&_sort=-date">Latest heart rates, newest first</Try>
          <Try url="Observation?code=8310-5,8331-1&_summary=count">How many temperatures exist</Try>
          <Try url="Condition?clinical-status=active&_count=5">Active conditions</Try>
          <Try url="MedicationRequest?_include=MedicationRequest:medication&_count=5">Prescriptions with their Medication</Try>
        </ul>
      </section>

      <section>
        <h3>5. Reading and writing</h3>
        <ul>
          <li><code>GET [base]/Patient/123</code> reads one resource.</li>
          <li><code>POST [base]/Patient</code> creates one; the server chooses the id and returns 201.</li>
          <li>
            <code>PUT [base]/Patient/123</code> replaces it. The app sends <code>If-Match</code> with{" "}
            <code>meta.versionId</code>; if someone changed the patient meanwhile, the server answers 409 instead of
            overwriting their change.
          </li>
        </ul>
      </section>

      <section>
        <h3>6. When something goes wrong</h3>
        <p>
          Errors come back as an <b>OperationOutcome</b> resource with a message in <code>issue[].diagnostics</code>.
          The HTTP status says what kind of problem it is:
        </p>
        <ul className="small">
          <li><b>400</b> the request or resource is invalid · <b>401/403</b> token missing or not allowed</li>
          <li><b>404</b> no such resource · <b>405</b> the server doesn’t support this (e.g. a disabled modifier)</li>
          <li><b>409/412</b> the resource changed since you read it · <b>5xx</b> a server problem</li>
        </ul>
      </section>

      <section>
        <h3>7. DICOM: medical images and their data</h3>
        <p>
          <b>DICOM</b> is the standard for medical images, both a file format and a network protocol. Every CT slice, MR
          image or X-ray is a DICOM <b>instance</b>: the pixels plus a header of <b>tags</b> describing them.
        </p>
        <p>Images are organised in four levels, each with its own unique id (UID):</p>
        <ul>
          <li><b>Patient</b>: identified by <code>PatientID</code> at the hospital that made the images.</li>
          <li>
            <b>Study</b>: one examination, such as “CT abdomen” on one day. Its <code>StudyInstanceUID</code> is what
            FHIR refers to.
          </li>
          <li><b>Series</b>: one acquisition within the study, e.g. the axial slices. <code>SeriesInstanceUID</code>.</li>
          <li>
            <b>Instance</b>: one image (some hold several <b>frames</b>, like a short film). <code>SOPInstanceUID</code>.
          </li>
        </ul>
        <p>
          A UID is digits and dots, at most 64 characters, unique worldwide, e.g. <code>1.2.826.0.1.3680043.…</code>: the
          first part belongs to the organisation that created it.
        </p>
        <p>
          Each tag has a number written <code>(group,element)</code>, a keyword and a data type (VR):{" "}
          <code>(0010,0010)</code> PatientName is a person name (PN), <code>(0020,000D)</code> StudyInstanceUID a unique
          id (UI), <code>(0008,0060)</code> Modality a code (CS) such as CT, MR or MG. In <b>DICOM JSON</b>, as DICOMweb
          returns them, the key is the tag without punctuation:
        </p>
        <pre className="small learn-code">{`"0020000D": { "vr": "UI", "Value": ["1.2.826.0.1…"] }`}</pre>
        <p className="small">
          All tags are in the{" "}
          <a href={DICOM_DICTIONARY} target="_blank" rel="noreferrer">
            DICOM data dictionary
          </a>
          . In the inspector, hover a tag number for its name and meaning.
        </p>
      </section>

      <section>
        <h3>8. DICOMweb: DICOM over the web</h3>
        <p>
          <b>DICOMweb</b> makes DICOM available as a RESTful API over HTTP, like FHIR: data has URLs, you read it with
          GET, and the <code>Accept</code> header chooses the format. It has three main services:
        </p>
        <ul>
          <li>
            <b>QIDO-RS</b> (query): search. <code>GET …/studies?PatientID=…</code>, <code>…/studies/{"{study}"}/series</code>,{" "}
            <code>…/series/{"{series}"}/instances</code>. The answer is a list in DICOM JSON, or HTTP 204 (empty) when
            nothing matches. <code>includefield</code> asks for more tags; <code>limit</code> and <code>offset</code> page
            through long lists.
          </li>
          <li>
            <b>WADO-RS</b> (retrieve): get the data. <code>…/instances/{"{instance}"}</code> returns the original DICOM
            file, <code>…/metadata</code> only the tags, and <code>…/rendered</code> an ordinary JPEG or PNG made by the
            server. This viewer uses <code>/rendered</code>, so the browser never has to decode DICOM, at the cost of the
            server’s default contrast.
          </li>
          <li>
            <b>STOW-RS</b> (store): upload with POST. The app doesn’t use it: it only reads, and on the public test server
            anything uploaded is visible to everyone.
          </li>
        </ul>
        <p>
          Unlike FHIR, DICOMweb has no resource types: everything is addressed by the study, series and instance UIDs.
          See the{" "}
          <a href={DICOMWEB_SPEC} target="_blank" rel="noreferrer">
            DICOMweb overview
          </a>{" "}
          and the{" "}
          <a href={DICOM_PART18} target="_blank" rel="noreferrer">
            standard (Part 18)
          </a>
          .
        </p>
        <p className="small">Run these through the app’s proxy; each opens in the request log:</p>
        <ul className="small">
          <DicomTry url={`${DICOMWEB_BASE}/qido/studies?limit=3`}>Three studies, with the server’s default tags (almost none)</DicomTry>
          <DicomTry url={`${DICOMWEB_BASE}/qido/studies?limit=5&includefield=0020000D&includefield=00100020&includefield=00080061&includefield=00080020`}>
            Five studies with UID, patient, modalities and date
          </DicomTry>
          <DicomTry url={patientStudiesUrl("MC_EXAMPLE_1")}>The studies of example patient MC_EXAMPLE_1</DicomTry>
          <DicomTry url={`${DICOMWEB_BASE}/qido/studies?StudyInstanceUID=1.2.3.4.5`}>A study that doesn’t exist (204, no body)</DicomTry>
          <DicomTry url={`${DICOMWEB_BASE}/qido/studies?PatientName=Smith`}>A search the app’s proxy doesn’t allow (403)</DicomTry>
        </ul>
      </section>

      <section>
        <h3>9. FHIR meets DICOM</h3>
        <p>
          In a hospital, images live in a <b>PACS</b> (the image archive, often with a DICOMweb interface), while the
          health record (FHIR) describes them with{" "}
          <a href={specUrl("ImagingStudy")} target="_blank" rel="noreferrer">
            ImagingStudy
          </a>
          :
        </p>
        <ul>
          <li>
            <code>identifier</code> holds the StudyInstanceUID: system <code>urn:dicom:uid</code>, value{" "}
            <code>urn:oid:1.2.3…</code>.
          </li>
          <li>
            <code>series[].uid</code> and <code>series[].instance[].uid</code> are the series and image UIDs;{" "}
            <code>modality</code> uses DICOM codes (CT, MR, DX…).
          </li>
          <li><code>endpoint</code> can say where the images are, e.g. a DICOMweb server.</li>
        </ul>
        <p>
          This app follows that path: FHIR <code>ImagingStudy?patient=…</code> → the StudyInstanceUID → a QIDO-RS search
          on the DICOM server → WADO-RS <code>/rendered</code> images. The Synthea test data invents its UIDs, so the
          search finds nothing (204) and those studies show “Not available”. The demo images come from example patients
          linked in <code>.env</code> (<code>DICOM_DEMO_PATIENTS</code>), and are labelled as another person’s images.
        </p>
        <p>
          <b>Between hospitals: IHE MADO.</b> This app knows where the images are because <code>.env</code> names one
          DICOM server. When images are shared between hospitals, the reader doesn’t know that in advance. The IHE
          profile{" "}
          <a href={IHE_MADO} target="_blank" rel="noreferrer">
            MADO
          </a>{" "}
          (Manifest-based Access to DICOM Objects) solves it with a <b>manifest</b> of the study, shared like any other
          document. It comes in two equivalent forms: a DICOM document (Key Object Selection), or a FHIR document Bundle
          with the ImagingStudy, the Patient, the requested procedure and <b>Endpoint</b> resources. The ImagingStudy
          already lists the series and images, so a viewer can show the study without searching first (no QIDO-RS); the
          Endpoint gives the WADO-RS address to retrieve the images from, and can name a web viewer. It is the same
          path this app follows, ImagingStudy → UIDs → DICOMweb, with the server’s address in the data instead of in a
          configuration file.
        </p>
      </section>
    </div>
  );
}
