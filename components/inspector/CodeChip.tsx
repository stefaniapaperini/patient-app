"use client";

import { CODE_SYSTEMS, codeMeaning, codeUrl } from "@/lib/inspector/glossary";

const SHORT: Record<string, string> = {
  "http://loinc.org": "LOINC",
  "http://snomed.info/sct": "SNOMED",
  "http://www.nlm.nih.gov/research/umls/rxnorm": "RxNorm",
};

/**
 * A code as a small chip (shown while the inspector is on), e.g. "LOINC 8867-4".
 * Hovering explains the code and its code system; LOINC codes link to loinc.org.
 */
export function CodeChip({ system, code, display }: { system?: string; code?: string; display?: string }) {
  if (!code) return null;
  const sys = system ? SHORT[system] ?? system : undefined;
  const title = [display ?? codeMeaning(code), system ? CODE_SYSTEMS[system] ?? system : undefined].filter(Boolean).join(" · ");
  const href = codeUrl(system, code);
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
