"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./fhir/client";

export interface AsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
  reload: () => void;
}

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
}

/**
 * Runs an async loader when `deps` change; ignores results from stale runs.
 * The loader receives an AbortSignal that fires when deps change or the component unmounts.
 *
 * `data` belongs to the deps it was loaded for: as soon as deps change (e.g. another patient id),
 * the old data is no longer returned, so a page never shows one record under another's URL.
 * `reload()` keeps the deps, so the current data stays visible while it refreshes.
 */
export function useAsync<T>(loader: (signal: AbortSignal) => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [result, setResult] = useState<{ deps: unknown[]; value: T }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    const ctrl = new AbortController();
    const runDeps = deps;
    setLoading(true);
    setError(undefined);
    loaderRef
      .current(ctrl.signal)
      .then((value) => {
        if (!ctrl.signal.aborted) setResult({ deps: runDeps, value });
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const data = result && sameDeps(result.deps, deps) ? result.value : undefined;
  // While deps have changed but the effect hasn't started yet, report loading rather than "no data".
  return { data, loading: loading || (!!result && data === undefined && !error), error, reload };
}
