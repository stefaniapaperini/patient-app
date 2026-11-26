"use client";

import Link from "next/link";
import { SEARCH_SPEC, specUrl } from "@/lib/inspector/glossary";

const tryIt = (url: string, method = "GET") => `/console?${new URLSearchParams({ method, url })}`;

function Try({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={tryIt(url)}>{children}</Link> <code className="small">{url}</code>
    </li>
  );
}

/** FHIR basics, in the order you meet them in this app, with examples to run in the console. */
export function LearnTab() {
  return (
    <div className="learn">
      <section>
        <h3>1. Resources</h3>
        <p>
          FHIR stores health data as <b>resources</b>: small JSON documents of a fixed type, each with an <code>id</code>.
          This app uses five types:
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
          <li><b>SNOMED CT</b> (http://snomed.info/sct) for diagnoses and findings.</li>
          <li><b>RxNorm</b> for medicines.</li>
        </ul>
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
    </div>
  );
}
