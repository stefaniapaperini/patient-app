/** Patient form values, validation, and conversion to/from the FHIR Patient resource. */
import { primaryName } from "./format";
import type { ContactPoint, Gender, Patient } from "./types";

export const GENDERS: { value: Gender; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "unknown", label: "Unknown" },
];

export interface PatientFormValues {
  given: string; // space-separated given names, e.g. "Mary Ann"
  family: string;
  gender: Gender | "";
  birthDate: string; // YYYY-MM-DD
  phone: string;
}

export type PatientFormErrors = Partial<Record<keyof PatientFormValues, string>>;

export const EMPTY_FORM: PatientFormValues = { given: "", family: "", gender: "", birthDate: "", phone: "" };

const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}' .-]*$/u;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_RE = /^\+?[0-9 ()./-]+$/;

/** Today in the user's local time zone, as YYYY-MM-DD. */
export function todayIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function validateName(value: string, label: string): string | undefined {
  const v = value.trim();
  if (!v) return `${label} is required.`;
  if (v.length > 100) return `${label} must be at most 100 characters.`;
  if (!NAME_RE.test(v)) return `${label} may contain only letters, spaces, apostrophes, dots and hyphens.`;
  return undefined;
}

export function validatePatient(v: PatientFormValues, now = new Date()): PatientFormErrors {
  const errors: PatientFormErrors = {};

  const given = validateName(v.given, "First name");
  if (given) errors.given = given;
  const family = validateName(v.family, "Last name");
  if (family) errors.family = family;

  if (!v.gender) errors.gender = "Gender is required.";
  else if (!GENDERS.some((g) => g.value === v.gender)) errors.gender = "Choose male, female, other or unknown.";

  const bd = v.birthDate.trim();
  if (!bd) errors.birthDate = "Date of birth is required.";
  else if (!isRealDate(bd)) errors.birthDate = "Enter a valid date (YYYY-MM-DD).";
  else if (bd > todayIso(now)) errors.birthDate = "Date of birth cannot be in the future.";
  else if (bd < "1900-01-01") errors.birthDate = "Date of birth cannot be before 1900.";

  const phone = v.phone.trim();
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    if (!PHONE_RE.test(phone)) errors.phone = "Phone may contain only digits, spaces, +, -, ( ) and dots.";
    else if (digits.length < 6 || digits.length > 15) errors.phone = "Phone must have between 6 and 15 digits.";
  }

  return errors;
}

/** Fills the form from an existing Patient. */
export function patientToForm(p: Patient): PatientFormValues {
  const n = primaryName(p);
  const g = GENDERS.some((x) => x.value === p.gender) ? (p.gender as Gender) : "";
  return {
    given: (n?.given ?? []).join(" "),
    family: n?.family ?? "",
    gender: g,
    birthDate: p.birthDate && DATE_RE.test(p.birthDate) ? p.birthDate : p.birthDate ?? "",
    phone: p.telecom?.find((t) => t.system === "phone")?.value ?? "",
  };
}

function splitGiven(given: string): string[] {
  return given.trim().split(/\s+/).filter(Boolean);
}

function normalize(v: PatientFormValues) {
  return {
    given: splitGiven(v.given),
    family: v.family.trim().replace(/\s+/g, " "),
    gender: v.gender as Gender,
    birthDate: v.birthDate.trim(),
    phone: v.phone.trim(),
  };
}

/** A new FHIR R4 Patient resource for POST. */
export function buildNewPatient(v: PatientFormValues): Patient {
  const n = normalize(v);
  const p: Patient = {
    resourceType: "Patient",
    name: [{ use: "official", given: n.given, family: n.family }],
    gender: n.gender,
    birthDate: n.birthDate,
  };
  if (n.phone) p.telecom = [{ system: "phone", value: n.phone }];
  return p;
}

/**
 * The full Patient for PUT: starts from the resource as read from the server so fields the
 * form does not edit (identifiers, address, extensions...) are kept, then replaces the name
 * the form shows, gender, birthDate and the first phone number.
 */
export function buildUpdatedPatient(original: Patient, v: PatientFormValues): Patient {
  const n = normalize(v);
  const updated: Patient = structuredClone(original);
  delete updated.meta; // server-managed

  const names = [...(original.name ?? [])];
  const shown = primaryName(original);
  const idx = shown ? names.indexOf(shown) : -1;
  // `text` is dropped because it would no longer match given/family.
  const { text: _text, ...rest } = shown ?? {};
  const newName = { ...rest, given: n.given, family: n.family };
  if (idx >= 0) names[idx] = newName;
  else names.unshift({ use: "official", ...newName });
  updated.name = names;

  updated.gender = n.gender;
  updated.birthDate = n.birthDate;

  const telecom: ContactPoint[] = [...(original.telecom ?? [])];
  const phoneIdx = telecom.findIndex((t) => t.system === "phone");
  if (n.phone) {
    if (phoneIdx >= 0) telecom[phoneIdx] = { ...telecom[phoneIdx], value: n.phone };
    else telecom.unshift({ system: "phone", value: n.phone });
  } else if (phoneIdx >= 0) {
    telecom.splice(phoneIdx, 1);
  }
  if (telecom.length) updated.telecom = telecom;
  else delete updated.telecom;

  return updated;
}
