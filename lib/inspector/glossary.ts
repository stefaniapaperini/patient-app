/**
 * Short, plain-language explanations used by the FHIR Inspector and the console:
 * search parameters, codes, code systems and resource fields. Not a complete reference: each
 * entry links to the FHIR R4 specification for the details.
 */

export const FHIR_SPEC = "https://hl7.org/fhir/R4";

export function specUrl(resourceType: string): string {
  return `${FHIR_SPEC}/${resourceType.toLowerCase()}.html`;
}

export const SEARCH_SPEC = `${FHIR_SPEC}/search.html`;

/** Search parameters (without modifier). */
export const PARAMS: Record<string, string> = {
  _id: "Only the resource with this id.",
  subject: "Only resources about this subject: a reference such as Patient/123.",
  patient: "Only resources for this patient (a shortcut for subject=Patient/…).",
  code: "Only resources with one of these codes. A comma means OR.",
  name: "Text search on any part of the name. It matches the start of a word and ignores case.",
  family: "Text search on the family (last) name.",
  given: "Text search on the given (first) names.",
  gender: "Only patients with this administrative gender.",
  birthdate: "Filter on the date of birth. Prefixes such as ge (≥) and le (≤) give ranges.",
  date: "Filter on the clinical date. Prefixes such as ge (≥) and le (≤) give ranges.",
  status: "Only resources with this status.",
  "clinical-status": "Only conditions with this clinical status, e.g. active or resolved.",
  category: "Only resources in this category, e.g. vital-signs.",
  _sort: "Sort order. A leading “-” sorts descending; a comma adds tie-breakers.",
  _count: "Page size: at most this many matches per page. Further pages are linked from Bundle.link “next”.",
  _total: "Ask the server to count every match into Bundle.total. “accurate” can be slower on big servers.",
  _include: "Also return resources the matches refer to, e.g. MedicationRequest:medication adds the Medication resources.",
  _revinclude: "Also return resources that refer to the matches.",
  _elements: "Return only these fields. The server marks such results as SUBSETTED.",
  _summary: "Return a summary. “count” returns only the number of matches, no resources.",
  _getpages: "HAPI’s id for a stored set of search results. The server puts it in paging links; you don’t build it yourself.",
  _getpagesoffset: "Where this page starts inside that stored result set.",
  _offset: "Skip this many matches (paging).",
  _bundletype: "The kind of Bundle the server returns for this page.",
  _content: "Full-text search over the whole resource (often disabled on servers).",
};

export const MODIFIERS: Record<string, string> = {
  contains: "“:contains” matches anywhere in the text, not only at the start. Some servers disable it.",
  exact: "“:exact” matches the whole text, with case and accents.",
  missing: "“:missing=true” finds resources where the field is empty.",
  not: "“:not” excludes this value.",
  text: "“:text” searches the display text of codes instead of the code itself.",
};

/** Codes seen in this app's data, with what they mean. */
export const CODES: Record<string, string> = {
  // LOINC vital signs
  "8867-4": "Heart rate",
  "8310-5": "Body temperature",
  "8331-1": "Oral temperature",
  "9279-1": "Respiratory rate",
  "59408-5": "Oxygen saturation by pulse oximetry",
  "2708-6": "Oxygen saturation in arterial blood",
  "8302-2": "Body height",
  "29463-7": "Body weight",
  "39156-5": "Body mass index (BMI)",
  "59576-9": "BMI percentile for age and sex",
  "55284-4": "Blood pressure, systolic and diastolic",
  "85354-9": "Blood pressure panel",
  "8480-6": "Systolic blood pressure",
  "8462-4": "Diastolic blood pressure",
  "72166-2": "Tobacco smoking status",
  "72514-3": "Pain severity, 0–10",
  // Status codes
  active: "Active: currently applies.",
  resolved: "Resolved: no longer applies.",
  inactive: "Inactive: no longer applies.",
  remission: "In remission.",
  recurrence: "Has come back.",
  completed: "Completed: finished as planned.",
  stopped: "Stopped before it was completed.",
  "entered-in-error": "Entered in error: should be ignored.",
  final: "Final: the result is complete and verified.",
  "vital-signs": "Vital signs category.",
};

export const CODE_SYSTEMS: Record<string, string> = {
  "http://loinc.org": "LOINC: codes for observations, measurements and lab tests.",
  "http://snomed.info/sct": "SNOMED CT: clinical terms such as diagnoses, findings and procedures.",
  "http://www.nlm.nih.gov/research/umls/rxnorm": "RxNorm: codes for medicines (US).",
  "http://unitsofmeasure.org": "UCUM: standard codes for units of measure.",
  "http://terminology.hl7.org/CodeSystem/condition-clinical": "HL7 code system for a condition’s clinical status.",
  "http://terminology.hl7.org/CodeSystem/condition-ver-status": "HL7 code system for how certain a diagnosis is.",
  "http://terminology.hl7.org/CodeSystem/observation-category": "HL7 code system for observation categories.",
};

export function codeUrl(system: string | undefined, code: string): string | undefined {
  if (system === "http://loinc.org") return `https://loinc.org/${encodeURIComponent(code)}/`;
  return undefined;
}

/**
 * Field explanations. Keys are "Type.path" or just "path" (indices removed, e.g.
 * "component.valueQuantity.value"); lookup tries the most specific key first.
 */
const FIELDS: Record<string, string> = {
  resourceType: "Which kind of FHIR resource this is.",
  id: "The resource’s id on this server. With the type it forms the reference, e.g. Patient/123.",
  meta: "Data about the resource itself: version, last change, profiles, tags.",
  "meta.versionId": "Version number. It goes up by one on every update; the app sends it in If-Match so two people can’t overwrite each other.",
  "meta.lastUpdated": "When the server last stored a change.",
  "meta.profile": "Profiles (rule sets) this resource claims to follow, e.g. US Core.",
  "meta.tag": "Labels used for workflow or filtering.",
  "meta.security": "Security labels, e.g. how confidential the resource is.",
  text: "Human-readable summary (HTML), generated for display.",
  identifier: "Business identifiers such as medical record or social security numbers.",
  extension: "Extra data not in the base specification, each identified by a URL.",
  "Patient.name": "The patient’s names. A patient can have several (official, maiden, nickname…).",
  "name.given": "Given (first and middle) names: a list.",
  "name.family": "Family (last) name.",
  "name.use": "What this name is for: official, usual, maiden, nickname…",
  "name.prefix": "Titles before the name, e.g. Mr. or Dr.",
  "Patient.gender": "Administrative gender: male, female, other or unknown.",
  "Patient.birthDate": "Date of birth. FHIR allows just a year (1980) or year and month (1980-04).",
  telecom: "Contact points: phone, email…",
  "telecom.system": "The kind of contact point: phone, email, fax…",
  "telecom.value": "The number or address.",
  address: "Postal addresses.",
  "Patient.deceasedDateTime": "When the patient died, if they have.",
  "Patient.maritalStatus": "Marital status, as a code.",
  "Patient.communication": "Languages the patient speaks.",
  status: "Status of the resource in its workflow.",
  "Observation.status": "Status of the result: final, amended, entered-in-error…",
  category: "Broad group, e.g. vital-signs or laboratory.",
  code: "What this is, as one or more codes from code systems (a CodeableConcept).",
  "code.coding": "The codes. Several can mean the same thing in different systems.",
  "coding.system": "The code system the code comes from, e.g. http://loinc.org.",
  "coding.code": "The code itself. Searches with code=… match this.",
  "coding.display": "The code system’s name for the code.",
  "code.text": "Plain text as the user entered or saw it.",
  subject: "Who this is about: a reference to the patient.",
  "subject.reference": "Reference: resource type and id, e.g. Patient/123.",
  encounter: "The visit during which this was recorded.",
  effectiveDateTime: "When the observation was taken (clinically relevant time).",
  effectivePeriod: "When the observation was taken, as a start and end.",
  issued: "When the result was made available.",
  valueQuantity: "The measured value with its unit.",
  "valueQuantity.value": "The number.",
  "valueQuantity.unit": "The unit as shown to people.",
  "valueQuantity.system": "The unit system, usually UCUM.",
  "valueQuantity.code": "The unit as a UCUM code, e.g. kg or [lb_av].",
  component: "Parts of one observation measured together, e.g. systolic and diastolic blood pressure.",
  "component.code": "What this part is (e.g. systolic blood pressure).",
  "component.valueQuantity": "This part’s value and unit.",
  "Condition.clinicalStatus": "Whether the condition applies now: active, recurrence, relapse, inactive, remission, resolved.",
  "Condition.verificationStatus": "How certain the diagnosis is: confirmed, provisional, refuted, entered-in-error…",
  onsetDateTime: "When the condition started.",
  abatementDateTime: "When the condition ended or went into remission.",
  recordedDate: "When the condition was first recorded.",
  "MedicationRequest.status": "Status of the prescription: active, completed, stopped…",
  "MedicationRequest.intent": "Whether it’s an order, a plan or a proposal.",
  medicationCodeableConcept: "The medicine, as codes written inside the request.",
  medicationReference: "The medicine, as a reference to a separate Medication resource.",
  authoredOn: "When the prescription was written.",
  requester: "Who wrote the prescription.",
  dosageInstruction: "How to take it: dose, timing and route.",
  "dosageInstruction.timing": "When and how often.",
  "dosageInstruction.doseAndRate": "How much per dose.",
  "dosageInstruction.route": "How it enters the body, e.g. oral.",
  "dosageInstruction.text": "The instructions as free text.",
  "Bundle.type": "What this Bundle is: searchset for search results, transaction, history…",
  "Bundle.total": "How many resources match the search in total, across all pages.",
  "Bundle.link": "Links for this page: self (this page), next and previous.",
  "link.relation": "What the link is: self, next, previous.",
  "link.url": "The URL to fetch. The app rewrites it to go through its proxy.",
  "Bundle.entry": "The resources on this page.",
  "entry.fullUrl": "The absolute URL of the resource.",
  "entry.resource": "The resource itself.",
  "entry.search": "Why the resource is in the results.",
  "entry.search.mode": "match: it matched the search. include: added by _include.",
  "ImagingStudy.identifier": "Identifiers of the study. The DICOM StudyInstanceUID is here, as urn:oid:1.2.3… (system urn:dicom:uid); the app looks it up on the DICOM server.",
  "ImagingStudy.status": "Status of the study: registered, available, cancelled…",
  "ImagingStudy.started": "When the study started.",
  "ImagingStudy.modality": "The kinds of equipment used, as DICOM modality codes: CT, MR, DX (X-ray)…",
  "ImagingStudy.numberOfSeries": "How many series (sets of images) the study has.",
  "ImagingStudy.numberOfInstances": "How many images (DICOM instances) the study has.",
  "ImagingStudy.procedureCode": "The procedure that was performed, as codes.",
  "ImagingStudy.endpoint": "Where the images can be retrieved, e.g. a DICOMweb server. Empty here: the app uses the server set in .env.",
  "ImagingStudy.series": "The series of the study: each a set of images from one acquisition.",
  "series.uid": "The DICOM SeriesInstanceUID.",
  "series.modality": "The modality of this series, e.g. CT.",
  "series.bodySite": "The part of the body imaged.",
  "series.numberOfInstances": "How many images this series has.",
  "series.instance": "The images (DICOM instances) of the series.",
  "series.instance.uid": "The DICOM SOPInstanceUID of one image.",
  vr: "DICOM Value Representation: the data type of this tag, e.g. UI (unique identifier), DA (date), PN (person name), CS (code), IS (integer).",
  Value: "The tag's values. DICOM JSON always uses a list, even for one value.",
  Alphabetic: "A person name in its alphabetic form: Family^Given^Middle.",
  "OperationOutcome.issue": "Problems the server reports: severity, kind and a message.",
  "issue.diagnostics": "The server’s message, meant for developers.",
};

/** "component[0].valueQuantity.value" -> "component.valueQuantity.value" */
export function normalizePath(path: string): string {
  return path.replace(/\[\d+\]/g, "").replace(/\[\*\]/g, "");
}

/** Explanation for a field of a resource, or undefined if the glossary has none. */
export function fieldDoc(resourceType: string | undefined, path: string): string | undefined {
  const parts = normalizePath(path).split(".");
  // DICOM JSON: keys are tags such as "0020000D".
  const last = parts[parts.length - 1];
  if (/^[0-9A-Fa-f]{8}$/.test(last)) {
    const t = DICOM_TAGS[last.toUpperCase()];
    return t ? `${dicomTagNotation(last)} ${t.name}: ${t.text}` : `DICOM tag ${dicomTagNotation(last)}.`;
  }
  // "Type.field" entries describe top-level fields only, so they are tried for the full path
  // alone: Patient.contact[0].name is the contact's name, not "Patient.name". Generic entries are
  // then tried on shorter suffixes: "name.given", "given".
  const full = parts.join(".");
  if (resourceType && FIELDS[`${resourceType}.${full}`]) return FIELDS[`${resourceType}.${full}`];
  for (let i = 0; i < parts.length; i++) {
    const suffix = parts.slice(i).join(".");
    if (FIELDS[suffix]) return FIELDS[suffix];
  }
  return undefined;
}

export function codeMeaning(code: string): string | undefined {
  return CODES[code];
}

// --- DICOM and DICOMweb ---------------------------------------------------------------------

export const DICOMWEB_SPEC = "https://www.dicomstandard.org/using/dicomweb";
export const DICOM_PART18 = "https://dicom.nema.org/medical/dicom/current/output/html/part18.html";
export const DICOM_DICTIONARY = "https://dicom.nema.org/medical/dicom/current/output/chtml/part06/chapter_6.html";

/** DICOM tags the app uses, keyed as in DICOM JSON ("0020000D"), with keyword and explanation. */
export const DICOM_TAGS: Record<string, { name: string; text: string }> = {
  "00080005": { name: "SpecificCharacterSet", text: "The character set of the text values." },
  "00080018": { name: "SOPInstanceUID", text: "Unique id of one image (instance). With the study and series UIDs it addresses the image in WADO-RS." },
  "00080020": { name: "StudyDate", text: "The date the study started, as YYYYMMDD." },
  "00080052": { name: "QueryRetrieveLevel", text: "The level this result is at: STUDY, SERIES or IMAGE." },
  "00080054": { name: "RetrieveAETitle", text: "The DICOM network name (AE title) of the server holding the data." },
  "00080060": { name: "Modality", text: "The kind of equipment that made the series: CT, MR, MG (mammography), DX (X-ray), US (ultrasound)…" },
  "00080061": { name: "ModalitiesInStudy", text: "All modalities of the study's series." },
  "00081030": { name: "StudyDescription", text: "Free-text description of the study, from the imaging department." },
  "0008103E": { name: "SeriesDescription", text: "Free-text description of the series." },
  "00100010": { name: "PatientName", text: "The patient's name. On this public server the examples are anonymised." },
  "00100020": { name: "PatientID", text: "The patient's id at the hospital that made the images. QIDO-RS can search by it." },
  "00100030": { name: "PatientBirthDate", text: "Date of birth, as YYYYMMDD." },
  "0020000D": { name: "StudyInstanceUID", text: "Globally unique id of the study. FHIR ImagingStudy.identifier holds the same value (urn:oid:…)." },
  "0020000E": { name: "SeriesInstanceUID", text: "Globally unique id of the series." },
  "00200011": { name: "SeriesNumber", text: "The series' number within the study." },
  "00200013": { name: "InstanceNumber", text: "The image's number within the series: the viewer shows images in this order." },
  "00201206": { name: "NumberOfStudyRelatedSeries", text: "How many series the study has." },
  "00201208": { name: "NumberOfStudyRelatedInstances", text: "How many images the study has." },
  "00201209": { name: "NumberOfSeriesRelatedInstances", text: "How many images the series has." },
  "00280008": { name: "NumberOfFrames", text: "Frames in this instance: more than 1 for multi-frame images (e.g. a cine loop), shown frame by frame." },
};

/** "0020000D" -> "StudyInstanceUID" (or undefined for tags the glossary doesn't know). */
export function dicomTagName(tag: string): string | undefined {
  return DICOM_TAGS[tag.toUpperCase()]?.name;
}

/** "0020000D" -> "(0020,000D)", the notation of the DICOM standard. */
export function dicomTagNotation(tag: string): string {
  const t = tag.toUpperCase();
  return `(${t.slice(0, 4)},${t.slice(4)})`;
}

/** QIDO-RS query parameters the app sends. */
export const DICOM_PARAMS: Record<string, string> = {
  PatientID: "Only studies of the patient with this DICOM PatientID (0010,0020). The app sends it for demo-linked patients.",
  StudyInstanceUID: "Only the study with this UID (0020,000D): how the app checks whether a FHIR ImagingStudy's images are on the server.",
  includefield: "Also return this tag in the results. Without it, a server returns only its default set of tags (this one returns almost none).",
  limit: "At most this many results. This server never returns more than 100 at once.",
  offset: "Skip this many results: with limit, it pages through long lists (e.g. a series of 116 images).",
};

