"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ConditionsSection } from "@/components/ConditionsSection";
import { MedicationsSection } from "@/components/MedicationsSection";
import { PatientFormModal } from "@/components/PatientFormModal";
import { VitalsSection } from "@/components/VitalsSection";
import { ErrorBanner, Loading } from "@/components/ui";
import { fhirFetch, FhirError } from "@/lib/fhir/client";
import { formatDate, formatGender, formatName } from "@/lib/fhir/format";
import type { Patient } from "@/lib/fhir/types";
import { useAsync } from "@/lib/useAsync";

function age(birthDate?: string): string | undefined {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return undefined;
  const [y, m, d] = birthDate.split("-").map(Number);
  const now = new Date();
  let a = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a--;
  return a >= 0 ? `${a} years` : undefined;
}

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [editing, setEditing] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const { data: patient, loading, error, reload } = useAsync(
    async (signal) => {
      setNotFound(false);
      try {
        return await fhirFetch<Patient>(`Patient/${encodeURIComponent(id)}`, { signal });
      } catch (e) {
        if (e instanceof FhirError && (e.status === 404 || e.status === 410)) setNotFound(true);
        throw e;
      }
    },
    [id],
  );

  const phone = patient?.telecom?.find((t) => t.system === "phone")?.value;

  return (
    <>
      <Link href="/" className="back">
        ← All patients
      </Link>

      <section className="card" aria-label="Demographics">
        {loading && !patient ? (
          <Loading label="Loading patient…" />
        ) : notFound ? (
          <ErrorBanner title="Patient not found" message={`There is no patient with id “${id}” on the FHIR server.`} />
        ) : error ? (
          <ErrorBanner title="Could not load the patient" message={error} onRetry={reload} />
        ) : patient ? (
          <div className="demo">
            <div>
              <h1>{formatName(patient)}</h1>
              <dl className="demo-grid">
                <div>
                  <dt>Gender</dt>
                  <dd>{formatGender(patient.gender)}</dd>
                </div>
                <div>
                  <dt>Date of birth</dt>
                  <dd>
                    {formatDate(patient.birthDate)}
                    {age(patient.birthDate) && <span className="muted small"> · {age(patient.birthDate)}</span>}
                  </dd>
                </div>
                {phone && (
                  <div>
                    <dt>Phone</dt>
                    <dd>{phone}</dd>
                  </div>
                )}
              </dl>
            </div>
            <button className="btn" onClick={() => setEditing(true)}>
              Edit patient
            </button>
          </div>
        ) : null}
      </section>

      {!notFound && (
        <>
          <VitalsSection patientId={id} />
          <ConditionsSection patientId={id} />
          <MedicationsSection patientId={id} />
        </>
      )}

      {editing && patient && (
        <PatientFormModal
          patient={patient}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}
    </>
  );
}
