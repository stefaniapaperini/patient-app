"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, fhirFetch, FhirError, nextLink, proxyUrl } from "./fhir/client";
import { primaryName } from "./fhir/format";
import type { Bundle, Patient } from "./fhir/types";

export const PAGE_SIZE = 50;
/** At most this many pages in a row are skipped when all their matches are hidden. */
const MAX_HIDDEN_PAGES = 10;

/** Case- and accent-insensitive form, as FHIR string search compares: "Éva" -> "eva". */
function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Whether the term matches the name the app shows for this patient (primaryName: the official or
 * usual name). The server's `name` search also matches every other name a patient has (a maiden
 * or old name), which the list never shows, so such a result would look like it has nothing to
 * do with the search: it is left out.
 * - contains: the term appears anywhere in the shown name.
 * - starts with (servers without :contains): a first, middle or last name starts with the term,
 *   or the whole shown name does ("livia ar").
 */
export function matchesShownName(p: Patient, term: string, contains: boolean): boolean {
  const t = fold(term.trim());
  if (!t) return true;
  const n = primaryName(p);
  if (!n) return false;
  // Exactly what formatName shows: given + family, or else the name's text.
  const names = [...(n.given ?? []), n.family ?? ""].filter((s) => s.trim());
  const parts = (names.length ? names : [n.text ?? ""]).filter((s) => s.trim()).map(fold);
  const full = parts.join(" ");
  if (contains) return full.includes(t);
  const words = parts.flatMap((s) => [s, ...s.split(/[\s-]+/)]);
  return full.startsWith(t) || words.some((w) => w.startsWith(t));
}

function patientsOf(bundle: Bundle<Patient>): Patient[] {
  return (bundle.entry ?? []).map((e) => e.resource!).filter((r) => r?.resourceType === "Patient");
}

export function patientSearchUrl(term: string, contains: boolean): string {
  const p = new URLSearchParams({ _count: String(PAGE_SIZE), _sort: "family,given", _total: "accurate" });
  const t = term.trim();
  if (t) p.set(contains ? "name:contains" : "name", t);
  return `Patient?${p.toString()}`;
}

/**
 * Server-side paged patient search. Loads the first page for `term`, and `loadMore()` follows
 * the Bundle's next link, so the list scales to thousands of patients.
 * Partial match uses name:contains; if the server rejects or disables that modifier, falls back to `name`
 * (which FHIR defines as a "starts with" match on any part of the name), and `mode` says so.
 * Results are narrowed to patients whose *shown* name matches (see matchesShownName); `hidden`
 * counts the ones left out, so the total can be corrected.
 */
export function usePatientSearch(term: string) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [total, setTotal] = useState<number>();
  /** The next-page link, with the search run that produced it: never followed for another search. */
  const [next, setNext] = useState<{ url: string; run: number; contains: boolean }>();
  /** Results of the loaded pages left out because only a name the list doesn't show matched. */
  const [hidden, setHidden] = useState(0);
  /** How the server matches names: "startsWith" once it has refused :contains. */
  const [mode, setMode] = useState<"contains" | "startsWith">("contains");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [moreError, setMoreError] = useState<string>();
  /** The request that produced the current list (for the FHIR Inspector). */
  const [requestUrl, setRequestUrl] = useState<string>();
  const [tick, setTick] = useState(0);
  const contains = useRef(true);
  const runId = useRef(0);

  useEffect(() => {
    const id = ++runId.current;
    const ctrl = new AbortController();
    setLoading(true);
    setError(undefined);
    setMoreError(undefined);
    // A loadMore from the previous search may still be running; its result is ignored (runId
    // changed) and it won't clear loadingMore itself, so clear it here or scrolling stays stuck.
    setLoadingMore(false);
    // The previous search's next link must not be followed for this one (it would append its patients).
    setNext(undefined);
    setHidden(0);
    // The inspector must show the request actually tried for *this* search, also when it fails,
    // never the previous search's.
    setRequestUrl(undefined);
    // Whether *this* run used :contains: another run may switch the shared flag off meanwhile.
    const usedContains = contains.current;
    let tried = patientSearchUrl(term, usedContains);

    const run = async () => {
      let bundle: Bundle<Patient>;
      let url = tried;
      let usedC = usedContains;
      try {
        bundle = await fhirFetch<Bundle<Patient>>(url, { signal: ctrl.signal });
      } catch (e) {
        // HAPI answers 400 for an unknown modifier, or 405 ("HAPI-1258") when :contains is disabled.
        if (term.trim() && usedContains && e instanceof FhirError && (e.status === 400 || e.status === 405 || e.status === 501)) {
          // 405/501 or HAPI-1258 mean the modifier is unsupported: remember that at once, even if the
          // retry below is cancelled. A plain 400 may have another cause, so it only counts once the
          // search without :contains succeeds.
          const unsupported = e.status === 405 || e.status === 501 || /HAPI-1258/.test(e.message);
          if (unsupported) contains.current = false;
          url = tried = patientSearchUrl(term, false);
          usedC = false;
          bundle = await fhirFetch<Bundle<Patient>>(url, { signal: ctrl.signal });
          contains.current = false;
        } else throw e;
      }
      // Keep only patients whose shown name matches. If a whole page is left out, load the next
      // one: an empty list would hide the rest of the results (nothing to scroll to).
      let kept = patientsOf(bundle).filter((p) => matchesShownName(p, term, usedC));
      let dropped = patientsOf(bundle).length - kept.length;
      let link = nextLink(bundle);
      for (let i = 0; kept.length === 0 && link && i < MAX_HIDDEN_PAGES; i++) {
        const more = await fhirFetch<Bundle<Patient>>(link, { signal: ctrl.signal, group: proxyUrl(url) });
        const page = patientsOf(more);
        kept = page.filter((p) => matchesShownName(p, term, usedC));
        dropped += page.length - kept.length;
        link = nextLink(more);
      }
      return { bundle, url, kept, dropped, link, usedC };
    };

    run()
      .then(({ bundle, url, kept, dropped, link, usedC }) => {
        if (id !== runId.current) return;
        setRequestUrl(url);
        setPatients(kept);
        setHidden(dropped);
        setTotal(bundle.total);
        setNext(link ? { url: link, run: id, contains: usedC } : undefined);
        if (term.trim()) setMode(usedC ? "contains" : "startsWith");
      })
      .catch((e) => {
        if (id !== runId.current || ctrl.signal.aborted) return;
        setRequestUrl(tried);
        setPatients([]);
        setTotal(undefined);
        setNext(undefined);
        setError(errorMessage(e));
      })
      .finally(() => {
        if (id === runId.current) setLoading(false);
      });
    return () => ctrl.abort();
  }, [term, tick]);

  const loadMore = useCallback(async () => {
    if (!next || loadingMore) return;
    const id = next.run;
    if (id !== runId.current) return; // a link from an earlier search
    setLoadingMore(true);
    setMoreError(undefined);
    try {
      const bundle = await fhirFetch<Bundle<Patient>>(next.url, { group: requestUrl ? proxyUrl(requestUrl) : undefined });
      if (id !== runId.current) return;
      const page = patientsOf(bundle);
      const kept = page.filter((p) => matchesShownName(p, term, next.contains));
      setHidden((h) => h + page.length - kept.length);
      setPatients((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...kept.filter((r) => !seen.has(r.id))];
      });
      const link = nextLink(bundle);
      setNext(link ? { url: link, run: id, contains: next.contains } : undefined);
    } catch (e) {
      if (id === runId.current) setMoreError(errorMessage(e));
    } finally {
      if (id === runId.current) setLoadingMore(false);
    }
  }, [next, loadingMore, requestUrl, term]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  // The server's total also counts patients matched only by a name that isn't shown.
  const shownTotal = total === undefined ? undefined : Math.max(total - hidden, patients.length);
  return {
    patients,
    total: shownTotal,
    /** True while more pages may still hide results, so `total` is an upper bound. */
    totalIsUpperBound: hidden > 0 && !!next,
    mode,
    hasMore: !!next,
    loading,
    loadingMore,
    error,
    moreError,
    loadMore,
    reload,
    requestUrl,
  };
}
