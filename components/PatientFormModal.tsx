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
  patient: opened,
  onClose,
  onSaved,
}: {
  patient?: Patient;
  onClose: () => void;
  onSaved: (saved: Patient) => void;
}) {
  /** The version the form is based on: the one it opened with, or a newer one after a conflict. */
  const [patient, setPatient] = useState(opened);
  const isEdit = !!patient?.id;
  const initial = useMemo(() => (patient ? patientToForm(patient) : EMPTY_FORM), [patient]);
  const [values, setValues] = useState<PatientFormValues>(initial);
  /**
   * Fields whose errors are shown: those the user has left (or changed, for the selects).
   * Errors are not shown in fields not yet reached, so a new form doesn't open covered in red.
   * An existing patient is checked at once, so problems in its stored data are visible.
   */
  const [touched, setTouched] = useState<Touched>(() => (opened?.id ? ALL_TOUCHED : {}));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const partialBirthDate = isPartialDate(initial.birthDate);

  // Checked on every change: the save button is enabled only when every rule is met.
  const allErrors = useMemo(() => validatePatient(values, new Date(), isEdit ? initial : undefined), [values, isEdit, initial]);
  const valid = Object.keys(allErrors).length === 0;
  const errors: PatientFormErrors = Object.fromEntries(
    Object.entries(allErrors).filter(([k]) => touched[k as keyof PatientFormValues]),
  );
  const touch = (k: keyof PatientFormValues) => setTouched((t) => (t[k] ? t : { ...t, [k]: true }));

  const set = (k: keyof PatientFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setValues({ ...values, [k]: e.target.value });
    // A choice in a select is complete at once; text fields are checked when the user leaves them.
    if (e.target instanceof HTMLSelectElement) touch(k);
  };

  const reset = () => {
    setValues(initial);
    setTouched(isEdit ? ALL_TOUCHED : {});
    setSaveError(undefined);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(undefined);
    // The button is disabled while the form is invalid; this guards any other way of submitting.
    if (!canSave) {
      setTouched(ALL_TOUCHED);
      return;
    }
    setSaving(true);
    try {
      let resource: Patient;
      let res: { body: Patient | undefined; location: string | undefined };
      if (isEdit) {
        // The copy the form opened with may be old (the list shows search results). Read the patient
        // again so fields others changed meanwhile (address, identifiers...) are kept, and stop if
        // someone changed a field this form edits, rather than overwrite it.
        const current = await fhirFetch<Patient>(`Patient/${encodeURIComponent(patient!.id!)}`);
        if (JSON.stringify(patientToForm(current)) !== JSON.stringify(patientToForm(patient!))) {
          // Show their version so the user can redo the edit on top of it; nothing was saved.
          setPatient(current);
          setValues(patientToForm(current));
          setTouched(ALL_TOUCHED);
          setSaveError(
            "Someone else changed this patient’s name, gender, birth date or phone since you opened the form. The form now shows their version: make your change again and save.",
          );
          setSaving(false);
          return;
        }
        const version = current.meta?.versionId;
        resource = { ...buildUpdatedPatient(current, values), id: patient!.id };
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
    onBlur: () => touch(k),
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
  // Updating needs a change; a new patient always differs from the empty form once it is valid.
  const canSave = valid && (dirty || !isEdit);
  const missing = REQUIRED.filter((k) => !values[k].trim()).length;

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
          {!valid && !saving && (
            <span className="small muted form-why" id="pf-why">
              {missing > 0 ? "Fill in all required fields (*)" : "Correct the marked fields"} to{" "}
              {isEdit ? "update" : "create"} the patient.
            </span>
          )}
          <button type="button" className="btn" onClick={reset} disabled={saving || !dirty}>
            Reset
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || !canSave} aria-describedby={!valid ? "pf-why" : undefined}>
            {saving && <span className="spinner" aria-hidden />}
            {isEdit ? (saving ? "Updating…" : "Update patient") : saving ? "Creating…" : "Create patient"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type Touched = Partial<Record<keyof PatientFormValues, boolean>>;
const ALL_TOUCHED: Touched = { given: true, family: true, gender: true, birthDate: true, phone: true };
const REQUIRED = ["given", "family", "gender", "birthDate"] as const;

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
