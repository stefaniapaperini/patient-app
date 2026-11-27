"use client";

import { CODE_SYSTEMS, codeLookupText, codeMeaning, codeUrl } from "@/lib/inspector/glossary";

const SHORT: Record<string, string> = {
  "http://loinc.org": "LOINC",
  "http://snomed.info/sct": "SNOMED",
  "http://www.nlm.nih.gov/research/umls/rxnorm": "RxNorm",
};

/**
 * A code as a small chip (shown while the inspector is on), e.g. "LOINC 8867-4".
 * Hovering explains the code and its code system; LOINC and SNOMED CT codes link to where they can be looked up.
 */
export function CodeChip({ system, code, display }: { system?: string; code?: string; display?: string }) {
  if (!code) return null;
  const sys = system ? SHORT[system] ?? system : undefined;
  const href = codeUrl(system, code);
  // A link opens another site: say so, as the JSON view does.
  const title = [
    display ?? codeMeaning(code, system),
    system ? CODE_SYSTEMS[system] ?? system : undefined,
    href ? `Click to ${codeLookupText(system)}.` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  const text = `${sys ? sys + " " : ""}${code}`;
  return href ? (
    <a className="code-chip" href={href} target="_blank" rel="noreferrer" title={title}>
      {text}
    </a>
  ) : (
    <span className="code-chip" title={title}>
      {text}
    </span>
  );
}
