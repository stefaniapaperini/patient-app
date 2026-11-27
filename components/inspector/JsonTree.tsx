"use client";

import { own } from "@/lib/own";
import { useState } from "react";
import { CODE_SYSTEMS, codeLookupText, codeMeaning, codeUrl, dicomTagName, fieldDoc } from "@/lib/inspector/glossary";

/** "component[0].code" -> "component[*].code", so highlights can name every array item at once. */
const wild = (p: string) => p.replace(/\[\d+\]/g, "[*]");

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Does `path` match a highlight pattern, or lie inside a highlighted field? */
export function isHighlighted(path: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    const re = new RegExp("^" + escapeRe(p).replace(/\\\[\\\*\\\]/g, "\\[\\d+\\]") + "(?:$|[.[])");
    return re.test(path);
  });
}

/** Should this node start expanded so a highlighted field below it is visible? */
function leadsToHighlight(path: string, patterns: string[]): boolean {
  const w = wild(path);
  return patterns.some((p) => {
    const pw = wild(p);
    return pw === w || pw.startsWith(w + ".") || pw.startsWith(w + "[");
  });
}

function childPath(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`;
  return parent ? `${parent}.${key}` : key;
}

/**
 * Collapsible JSON view of a FHIR resource (or Bundle).
 * - `highlight` marks the fields an element was built from.
 * - Hovering a field name explains it; codes and code systems show their meaning.
 */
export function JsonTree({
  value,
  highlight = [],
  resourceType,
  defaultDepth = 1,
}: {
  value: unknown;
  highlight?: string[];
  resourceType?: string;
  defaultDepth?: number;
}) {
  const type =
    resourceType ?? (value && typeof value === "object" && "resourceType" in value ? String((value as { resourceType: unknown }).resourceType) : undefined);
  return (
    <div className="json" role="tree">
      <Node value={value} path="" depth={0} highlight={highlight} resourceType={type} defaultDepth={defaultDepth} parent={undefined} />
    </div>
  );
}

function Node({
  name,
  value,
  path,
  depth,
  highlight,
  resourceType,
  defaultDepth,
  parent,
}: {
  name?: string | number;
  value: unknown;
  path: string;
  depth: number;
  highlight: string[];
  resourceType?: string;
  defaultDepth: number;
  parent: Record<string, unknown> | undefined;
}) {
  const isObj = value !== null && typeof value === "object";
  const hl = path !== "" && highlight.length > 0 && isHighlighted(path, highlight);
  const [open, setOpen] = useState(() => depth < defaultDepth || (path !== "" && leadsToHighlight(path, highlight)) || depth === 0);
  // Nested resources (Bundle entries, contained) explain their own fields.
  const ownType =
    isObj && !Array.isArray(value) && typeof (value as Record<string, unknown>).resourceType === "string"
      ? ((value as Record<string, unknown>).resourceType as string)
      : resourceType;
  const docPath = path.replace(/^entry\[\d+\]\.resource\.?/, "");
  const doc = typeof name === "string" ? fieldDoc(resourceType, docPath || name) : undefined;

  // DICOM JSON keys are tag numbers ("0020000D"): show the tag's name next to it.
  const tagName = typeof name === "string" && /^[0-9A-Fa-f]{8}$/.test(name) ? dicomTagName(name) : undefined;
  const label =
    name === undefined ? null : (
      <span className={`json-key${doc ? " has-doc" : ""}`} title={doc}>
        {typeof name === "number" ? `[${name}]` : name}
        {tagName && <span className="json-tagname"> {tagName}</span>}
        {": "}
      </span>
    );

  if (!isObj) {
    return (
      <div className={`json-row${hl ? " json-hl" : ""}`} role="treeitem" style={{ paddingLeft: depth * 14 }}>
        {label}
        <Scalar value={value} name={name} parent={parent} />
      </div>
    );
  }

  const entries: [string | number, unknown][] = Array.isArray(value)
    ? value.map((v, i) => [i, v])
    : Object.entries(value as Record<string, unknown>);
  const brackets = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  const summary = Array.isArray(value) ? `${entries.length} item${entries.length === 1 ? "" : "s"}` : preview(value as Record<string, unknown>);

  return (
    <div role="treeitem" aria-expanded={open}>
      <div className={`json-row${hl ? " json-hl" : ""}`} style={{ paddingLeft: depth * 14 }}>
        <button type="button" className="json-toggle" onClick={() => setOpen(!open)} aria-label={open ? "Collapse" : "Expand"}>
          {open ? "▾" : "▸"}
        </button>
        {label}
        <span className="json-punct">{brackets[0]}</span>
        {!open && (
          <>
            <span className="json-summary"> {summary} </span>
            <span className="json-punct">{brackets[1]}</span>
          </>
        )}
      </div>
      {open && (
        <>
          <div role="group">
            {entries.map(([k, v]) => (
              <Node
                key={k}
                name={k}
                value={v}
                path={childPath(path, k)}
                depth={depth + 1}
                highlight={highlight}
                resourceType={ownType}
                defaultDepth={defaultDepth}
                parent={Array.isArray(value) ? undefined : (value as Record<string, unknown>)}
              />
            ))}
          </div>
          <div className="json-row" style={{ paddingLeft: depth * 14 + 14 }}>
            <span className="json-punct">{brackets[1]}</span>
          </div>
        </>
      )}
    </div>
  );
}

/** One-line preview of a collapsed object: its resourceType/id, a code's display, or its keys. */
function preview(o: Record<string, unknown>): string {
  if (typeof o.resourceType === "string") return `${o.resourceType}${o.id ? "/" + o.id : ""}`;
  if (typeof o.display === "string") return o.display;
  if (typeof o.text === "string") return o.text;
  if (typeof o.reference === "string") return o.reference;
  const keys = Object.keys(o);
  return keys.slice(0, 3).join(", ") + (keys.length > 3 ? ", …" : "");
}

function Scalar({ value, name, parent }: { value: unknown; name?: string | number; parent?: Record<string, unknown> }) {
  if (typeof value === "string") {
    // A code inside a Coding (or a status code): show what it means.
    let meaning: string | undefined;
    let href: string | undefined;
    if (name === "code") {
      const system = typeof parent?.system === "string" ? parent.system : undefined;
      href = codeUrl(system, value);
      // An unknown code that can be looked up (e.g. SNOMED CT) gets a link to do so.
      meaning = codeMeaning(value, system) ?? (href ? codeLookupText(system) : undefined);
    } else if (name === "system") {
      meaning = own(CODE_SYSTEMS, value);
    } else if (name === "status") {
      meaning = codeMeaning(value);
    }
    return (
      <>
        <span className="json-str">&quot;{value}&quot;</span>
        {meaning && (
          <span className="json-meaning">
            {" "}
            ← {href ? (
              <a href={href} target="_blank" rel="noreferrer">
                {meaning}
              </a>
            ) : (
              meaning
            )}
          </span>
        )}
      </>
    );
  }
  if (typeof value === "number") return <span className="json-num">{value}</span>;
  if (typeof value === "boolean") return <span className="json-bool">{String(value)}</span>;
  return <span className="json-null">null</span>;
}
