/** Minimal FHIR R4 types: only the fields this app reads or writes. */

export interface Coding {
  system?: string;
  code?: string;
  display?: string;
}

export interface CodeableConcept {
  coding?: Coding[];
  text?: string;
}

export interface Reference {
  reference?: string;
  display?: string;
}

export interface Quantity {
  value?: number;
  unit?: string;
  code?: string;
  system?: string;
}

export interface Period {
  start?: string;
  end?: string;
}

export interface HumanName {
  use?: string;
  text?: string;
  family?: string;
  given?: string[];
  prefix?: string[];
  suffix?: string[];
  period?: Period;
}

export interface ContactPoint {
  system?: "phone" | "fax" | "email" | "pager" | "url" | "sms" | "other";
  value?: string;
  use?: string;
  rank?: number;
}

export interface Meta {
  versionId?: string;
  lastUpdated?: string;
}

export interface Resource {
  resourceType: string;
  id?: string;
  meta?: Meta;
  contained?: Resource[];
  [key: string]: unknown;
}

export type Gender = "male" | "female" | "other" | "unknown";

export interface Patient extends Resource {
  resourceType: "Patient";
  name?: HumanName[];
  gender?: Gender;
  birthDate?: string;
  telecom?: ContactPoint[];
}

export interface ObservationComponent {
  code: CodeableConcept;
  valueQuantity?: Quantity;
}

export interface Observation extends Resource {
  resourceType: "Observation";
  status?: string;
  code: CodeableConcept;
  effectiveDateTime?: string;
  effectivePeriod?: Period;
  effectiveInstant?: string;
  issued?: string;
  valueQuantity?: Quantity;
  component?: ObservationComponent[];
}

export interface Age extends Quantity {}
export interface Range {
  low?: Quantity;
  high?: Quantity;
}

export interface Condition extends Resource {
  resourceType: "Condition";
  code?: CodeableConcept;
  clinicalStatus?: CodeableConcept;
  verificationStatus?: CodeableConcept;
  onsetDateTime?: string;
  onsetPeriod?: Period;
  onsetString?: string;
  onsetAge?: Age;
  onsetRange?: Range;
  recordedDate?: string;
}

export interface Timing {
  code?: CodeableConcept;
  repeat?: {
    frequency?: number;
    frequencyMax?: number;
    period?: number;
    periodMax?: number;
    periodUnit?: "s" | "min" | "h" | "d" | "wk" | "mo" | "a";
    when?: string[];
    timeOfDay?: string[];
  };
}

export interface Dosage {
  text?: string;
  timing?: Timing;
  asNeededBoolean?: boolean;
  asNeededCodeableConcept?: CodeableConcept;
  route?: CodeableConcept;
  doseAndRate?: {
    doseQuantity?: Quantity;
    doseRange?: Range;
  }[];
}

export interface MedicationRequest extends Resource {
  resourceType: "MedicationRequest";
  status?: string;
  intent?: string;
  authoredOn?: string;
  medicationCodeableConcept?: CodeableConcept;
  medicationReference?: Reference;
  dosageInstruction?: Dosage[];
}

export interface Medication extends Resource {
  resourceType: "Medication";
  code?: CodeableConcept;
}

export interface OperationOutcome extends Resource {
  resourceType: "OperationOutcome";
  issue?: { severity?: string; code?: string; diagnostics?: string; details?: CodeableConcept }[];
}

export interface BundleEntry<T extends Resource = Resource> {
  fullUrl?: string;
  resource?: T;
  search?: { mode?: "match" | "include" | "outcome" };
}

export interface Bundle<T extends Resource = Resource> extends Resource {
  resourceType: "Bundle";
  type?: string;
  total?: number;
  link?: { relation: string; url: string }[];
  entry?: BundleEntry<T>[];
}
