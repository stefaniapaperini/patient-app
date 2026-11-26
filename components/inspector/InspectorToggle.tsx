"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { openPanel, setEnabled, useInspectorEnabled, useLogCount } from "@/lib/inspector/store";

/**
 * Header controls. The switch turns on "learning mode": with it off the header shows only the
 * switch, so the app looks like a plain patient app; with it on, the console and request log
 * links appear too. /console itself always works (bookmarks, Learn FHIR examples), and its link
 * stays visible while you're on it.
 */
export function InspectorToggle() {
  const enabled = useInspectorEnabled();
  const logCount = useLogCount();
  const pathname = usePathname();
  const onConsole = pathname === "/console";
  return (
    <div className="topbar-tools">
      {(enabled || onConsole) && (
        <Link href="/console" className={`btn btn-sm${onConsole ? " active" : ""}`}>
          FHIR Console
        </Link>
      )}
      {enabled && (
        <button type="button" className="btn btn-sm" onClick={() => openPanel("log")}>
          Request log ({logCount})
        </button>
      )}
      {enabled && (
        <button type="button" className="btn btn-sm" onClick={() => openPanel("learn")}>
          Learn FHIR
        </button>
      )}
      <button
        type="button"
        className={`switch${enabled ? " on" : ""}`}
        role="switch"
        aria-checked={enabled}
        onClick={() => setEnabled(!enabled)}
        title="Outline the parts of the page that come from FHIR; right-click one to inspect it"
      >
        <span className="switch-track" aria-hidden>
          <span className="switch-thumb" />
        </span>
        FHIR Inspector
      </button>
    </div>
  );
}
