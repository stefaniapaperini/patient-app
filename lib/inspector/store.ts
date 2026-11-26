"use client";

/**
 * FHIR Inspector state, shared by the whole app without a React provider:
 * - whether inspector mode is on (off on every page load; never stored),
 * - a log of every FHIR request the app made (most recent last, capped),
 * - what the side panel is showing.
 * Components read it with useInspector(); the FHIR client writes to it via recordRequest().
 */
import { useSyncExternalStore } from "react";
import type { Resource } from "@/lib/fhir/types";

export interface LogEntry {
  id: number;
  method: string;
  /** Proxy URL as the browser called it, e.g. /api/fhir/Patient?name=x */
  url: string;
  /** For multi-page searches: the URL of the first page, shared by every page of that search. */
  group?: string;
  startedAt: number; // epoch ms
  durationMs?: number;
  status?: number; // undefined while pending, 0 for network errors
  requestBody?: unknown;
  responseBody?: unknown;
  location?: string;
  error?: string;
}

/** What an inspectable element is made of, shown in the element panel. */
export interface InspectTarget {
  title: string;
  /** One line telling the user how this element relates to FHIR. */
  description?: string;
  /** Requests (as passed to fhirFetch, e.g. "Condition?patient=1") whose results built this element. */
  requests: string[];
  /** The resources behind the element. */
  resources?: Resource[];
  /** Field paths to highlight in those resources, e.g. "valueQuantity.value" or "component[*].code". */
  highlight?: string[];
  /** Set on an empty vital-sign chart: lets the panel check whether data is missing or the query is wrong. */
  emptyVital?: { patientId: string; label: string; codes: string[] };
}

/**
 * What the side panel shows. Each view is its own panel with its own title (no tabs):
 * element = the FHIR data behind an inspected element, log = the request log, learn = FHIR basics.
 */
export type PanelView = "element" | "log" | "learn";

interface State {
  enabled: boolean;
  log: LogEntry[];
  panelOpen: boolean;
  view: PanelView;
  target: InspectTarget | null;
  /** Log entry expanded in the request log. */
  selectedLogId: number | null;
}

const MAX_LOG = 150;

let state: State = { enabled: false, log: [], panelOpen: false, view: "element", target: null, selectedLogId: null };
let nextId = 1;
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const SERVER_STATE = state;

export function useInspector(): State {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}

/**
 * Turns inspector mode on or off. Deliberately not stored: the app always starts as a plain
 * patient app, and the setting lasts only until the page is reloaded (moving between pages
 * inside the app keeps it).
 */
export function setEnabled(enabled: boolean) {
  set(enabled ? { enabled } : { enabled, panelOpen: false, target: null });
}

export function inspect(target: InspectTarget) {
  set({ target, panelOpen: true, view: "element" });
}

export function openPanel(view: PanelView, selectedLogId: number | null = state.selectedLogId) {
  set({ panelOpen: true, view, selectedLogId });
}

export function closePanel() {
  set({ panelOpen: false });
}


export function selectLog(id: number | null) {
  set({ selectedLogId: id });
}

export function clearLog() {
  set({ log: [], selectedLogId: null });
}

/** Called by the FHIR client before a request; returns a function to call with the outcome. */
export function recordRequest(entry: Omit<LogEntry, "id" | "startedAt">): (done: Partial<LogEntry>) => void {
  const id = nextId++;
  const started = performance.now();
  const e: LogEntry = { ...entry, id, startedAt: Date.now() };
  set({ log: [...state.log, e].slice(-MAX_LOG) });
  return (done) => {
    set({
      log: state.log.map((x) => (x.id === id ? { ...x, ...done, durationMs: Math.round(performance.now() - started) } : x)),
    });
  };
}

/**
 * The log entries of the latest run of a request: the first page whose URL matches, plus the
 * later pages of the same search (same group). Most recent run wins.
 */
export function entriesFor(log: LogEntry[], proxiedUrl: string): LogEntry[] {
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].url === proxiedUrl) {
      const first = log[i];
      return [first, ...log.slice(i + 1).filter((e) => e.group === proxiedUrl && e.url !== proxiedUrl)];
    }
  }
  return [];
}
