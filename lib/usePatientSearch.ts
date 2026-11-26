"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, fhirFetch, FhirError, nextLink, proxyUrl } from "./fhir/client";
import type { Bundle, Patient } from "./fhir/types";

export const PAGE_SIZE = 50;

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
 * (which FHIR defines as a "starts with" match on any part of the name).
 */
export function usePatientSearch(term: string) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [total, setTotal] = useState<number>();
  const [next, setNext] = useState<string>();
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

    const run = async () => {
      let bundle: Bundle<Patient>;
      let url = patientSearchUrl(term, contains.current);
      try {
        bundle = await fhirFetch<Bundle<Patient>>(url, { signal: ctrl.signal });
      } catch (e) {
        // HAPI answers 400 for an unknown modifier, or 405 ("HAPI-1258") when :contains is disabled.
        if (term.trim() && contains.current && e instanceof FhirError && (e.status === 400 || e.status === 405 || e.status === 501)) {
          contains.current = false;
          url = patientSearchUrl(term, false);
          bundle = await fhirFetch<Bundle<Patient>>(url, { signal: ctrl.signal });
        } else throw e;
      }
      return { bundle, url };
    };

    run()
      .then(({ bundle, url }) => {
        if (id !== runId.current) return;
        setRequestUrl(url);
        setPatients((bundle.entry ?? []).map((e) => e.resource!).filter((r) => r?.resourceType === "Patient"));
        setTotal(bundle.total);
        setNext(nextLink(bundle));
      })
      .catch((e) => {
        if (id !== runId.current || ctrl.signal.aborted) return;
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
    const id = runId.current;
    setLoadingMore(true);
    setMoreError(undefined);
    try {
      const bundle = await fhirFetch<Bundle<Patient>>(next, { group: requestUrl ? proxyUrl(requestUrl) : undefined });
      if (id !== runId.current) return;
      setPatients((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const add = (bundle.entry ?? [])
          .map((e) => e.resource!)
          .filter((r) => r?.resourceType === "Patient" && !seen.has(r.id));
        return [...prev, ...add];
      });
      setNext(nextLink(bundle));
    } catch (e) {
      if (id === runId.current) setMoreError(errorMessage(e));
    } finally {
      if (id === runId.current) setLoadingMore(false);
    }
  }, [next, loadingMore, requestUrl]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { patients, total, hasMore: !!next, loading, loadingMore, error, moreError, loadMore, reload, requestUrl };
}
