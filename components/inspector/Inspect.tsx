"use client";

import type { MouseEvent } from "react";
import { inspect, type InspectTarget } from "@/lib/inspector/store";

/**
 * Props that make an element inspectable while inspector mode is on: an outline, and a
 * right-click that opens the element in the inspector panel instead of the browser menu.
 * The target is built lazily, only when the element is actually inspected.
 * Use together with <InspectButton>, which gives keyboard and touch users the same action.
 */
export function inspectable(enabled: boolean, target: () => InspectTarget) {
  if (!enabled) return {};
  return {
    "data-inspect": "",
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation(); // the innermost element wins (a row, not its whole section)
      inspect(target());
    },
  };
}

export function InspectButton({
  enabled,
  target,
  label,
}: {
  enabled: boolean;
  target: () => InspectTarget;
  label: string;
}) {
  if (!enabled) return null;
  return (
    <button
      type="button"
      className="inspect-btn"
      aria-label={`Inspect FHIR data: ${label}`}
      title="Show the FHIR data behind this (or right-click it)"
      onClick={(e) => {
        e.stopPropagation(); // don't trigger the row's own click (e.g. opening the patient)
        inspect(target());
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      ⓘ
    </button>
  );
}
