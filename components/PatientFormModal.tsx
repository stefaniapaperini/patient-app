"use client";

import { useMemo, useState } from "react";
import { Modal } from "./ui";
import { errorMessage, fhirFetch, fhirRequest } from "@/lib/fhir/client";
import {
  buildNewPatient,
  buildUpdatedPatient,
  EMPTY_FORM,
  GENDERS,
  isPartialDate,
  patientToForm,
  todayIso,
  validatePatient,
  type PatientFormErrors,
  type PatientFormValues,
} from "@/lib/fhir/patient";
import type { Patient } from "@/lib/fhir/types";

/**
 * Create (no `patient`) or edit (`patient` given) form in a modal.
 * Create: POST /Patient. Edit: PUT /Patient/{id} with If-Match on the version read.
 */
export function PatientFormModal({
  patient,
  onClose,
  onSaved,
}: {
  patient?: Patient;
  onClose: () => void;
  onSaved: (saved: Patient) => void;
}) {
  const isEdit = !!patient?.id;
  const initial = useMemo(() => (patient ? patientToForm(patient) : EMPTY_FORM), [patient]);
  const [values, setValues] = useState<PatientFormValues>(initial);
  const [errors, setErrors] = useState<PatientFormErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const partialBirthDate = isPartialDate(initial.birthDate);

  const set = (k: keyof PatientFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const next = { ...values, [k]: e.target.value };
    setValues(next);
    // After the first submit attempt, re-validate as the user types so errors clear.
    if (submitted) setErrors(validatePatient(next));
  };

  const reset = () => {
    setValues(initial);
    setErrors({});
    setSubmitted(false);
    setSaveError(undefined);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setSaveError(undefined);
    const errs = validatePatient(values);
    setErrors(errs);
    if (Object.keys(errs).length) {
      const firstKey = Object.keys(errs)[0];
      document.getElementById(`pf-${firstKey}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      let resource: Patient;
      let res: { body: Patient | undefined; location: string | undefined };
      if (isEdit) {
        const version = patient!.meta?.versionId;
        resource = { ...buildUpdatedPatient(patient!, values), id: patient!.id };
        res = await fhirRequest<Patient>(`Patient/${encodeURIComponent(patient!.id!)}`, {
          method: "PUT",
          json: resource,
          headers: version ? { "If-Match": `W/"${version}"` } : undefined,
        });
      } else {
        resource = buildNewPatient(values);
        res = await fhirRequest<Patient>("Patient", { method: "POST", json: resource });
      }
      const saved = await savedPatient(res, resource, isEdit ? patient!.id : undefined);
      onSaved(saved);
    } catch (err) {
      setSaveError(errorMessage(err));
      setSaving(false);
    }
  };

  const fieldProps = (k: keyof PatientFormValues) => ({
    id: `pf-${k}`,
    name: k,
    value: values[k],
    onChange: set(k),
    "aria-invalid": errors[k] ? true : undefined,
    "aria-describedby": errors[k] ? `pf-${k}-err` : undefined,
    disabled: saving,
  });

  const err = (k: keyof PatientFormValues) =>
    errors[k] ? (
      <span className="error" id={`pf-${k}-err`}>
        {errors[k]}
      </span>
    ) : null;

  const dirty = JSON.stringify(values) !== JSON.stringify(initial);

  return (
    <Modal title={isEdit ? "Edit patient" : "New patient"} onClose={() => !saving && onClose()}>
      <form onSubmit={submit} noValidate>
        <div className="modal-body">
          {saveError && (
            <div className="alert" role="alert">
              <div>
                <strong>{isEdit ? "Could not update the patient" : "Could not create the patient"}</strong>
                {saveError}
              </div>
            </div>
          )}
          <div className="row-2">
            <div className="field">
              <label htmlFor="pf-given">
                First name(s)<span className="req">*</span>
              </label>
              <input className="input" autoComplete="off" {...fieldProps("given")} />
              {err("given") ?? <span className="hint">Separate several given names with spaces.</span>}
            </div>
            <div className="field">
              <label htmlFor="pf-family">
                Last name<span className="req">*</span>
              </label>
              <input className="input" autoComplete="off" {...fieldProps("family")} />
              {err("family")}
            </div>
          </div>
          <div className="row-2">
            <div className="field">
              <label htmlFor="pf-gender">
                Gender<span className="req">*</span>
              </label>
              <select className="select" {...fieldProps("gender")}>
                <option value="">Select…</option>
                {GENDERS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
              {err("gender")}
            </div>
            <div className="field">
              <label htmlFor="pf-birthDate">
                Date of birth<span className="req">*</span>
              </label>
              {partialBirthDate ? (
                // A date picker can't show "1980" or "1980-04" (it would look empty), so a stored
                // partial date is edited as text and kept unless the user changes it.
                <input className="input" type="text" inputMode="numeric" placeholder="YYYY-MM-DD" {...fieldProps("birthDate")} />
              ) : (
                <input className="input" type="date" min="1900-01-01" max={todayIso()} {...fieldProps("birthDate")} />
              )}
              {err("birthDate") ??
                (partialBirthDate && <span className="hint">Only the year or month is recorded. Add the full date if you know it.</span>)}
            </div>
          </div>
          <div className="field">
            <label htmlFor="pf-phone">Phone number</label>
            <input className="input" type="tel" autoComplete="off" placeholder="+44 20 7946 0000" {...fieldProps("phone")} />
            {err("phone") ?? <span className="hint">Optional. Digits, spaces, +, -, ( ).</span>}
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={reset} disabled={saving || (!dirty && !submitted)}>
            Reset
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving && <span className="spinner" aria-hidden />}
            {isEdit ? (saving ? "Updating…" : "Update patient") : saving ? "Creating…" : "Create patient"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * The patient as stored. Servers normally echo it back (we send Prefer: return=representation),
 * but some return an empty body: then re-read it from the Location header (or by id when
 * editing), and as a last resort use what was submitted. The save itself already succeeded,
 * so a failed re-read must not turn it into an error.
 */
async function savedPatient(
  res: { body: Patient | undefined; location: string | undefined },
  submitted: Patient,
  editedId?: string,
): Promise<Patient> {
  if (res.body?.resourceType === "Patient") return res.body;
  const readPath = res.location ?? (editedId ? `Patient/${encodeURIComponent(editedId)}` : undefined);
  if (readPath) {
    try {
      const p = await fhirFetch<Patient>(readPath);
      if (p?.resourceType === "Patient") return p;
    } catch {
      // fall through
    }
  }
  return submitted;
}
