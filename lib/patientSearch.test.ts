import { describe, expect, it } from "vitest";
import type { Patient } from "./fhir/types";
import { matchesShownName } from "./usePatientSearch";

const livia: Patient = {
  resourceType: "Patient",
  name: [
    { use: "official", given: ["Livia", "Argentina"], family: "Cartwright" },
    { use: "maiden", given: ["Livia", "Argentina"], family: "Wiza" },
  ],
};

describe("matchesShownName", () => {
  it("starts-with: matches the start of a shown first, middle or last name", () => {
    expect(matchesShownName(livia, "liv", false)).toBe(true);
    expect(matchesShownName(livia, "Arg", false)).toBe(true);
    expect(matchesShownName(livia, "cart", false)).toBe(true);
    expect(matchesShownName(livia, "livia ar", false)).toBe(true);
    expect(matchesShownName(livia, "wright", false)).toBe(false);
  });
  it("never matches a name the list does not show, such as a maiden name", () => {
    // The server's name=w matches Livia through her maiden name Wiza; the list shows Cartwright.
    expect(matchesShownName(livia, "w", false)).toBe(false);
    expect(matchesShownName(livia, "wiza", true)).toBe(false);
  });
  it("contains: matches anywhere in the shown name", () => {
    expect(matchesShownName(livia, "g", true)).toBe(true);
    expect(matchesShownName(livia, "twr", true)).toBe(true);
  });
  it("ignores case and accents, like FHIR string search", () => {
    const eva: Patient = { resourceType: "Patient", name: [{ given: ["Éva"], family: "Núñez" }] };
    expect(matchesShownName(eva, "eva", false)).toBe(true);
    expect(matchesShownName(eva, "NUN", false)).toBe(true);
  });
  it("matches the text of a name that has no given or family parts, as the list shows it", () => {
    const john: Patient = { resourceType: "Patient", name: [{ use: "official", text: "John Smith" }] };
    expect(matchesShownName(john, "john", false)).toBe(true);
    expect(matchesShownName(john, "smi", false)).toBe(true);
    expect(matchesShownName(john, "n sm", true)).toBe(true);
    // With given/family, the list shows those, so a different text is not matched.
    const both: Patient = { resourceType: "Patient", name: [{ given: ["Ann"], family: "Lee", text: "Dr Ann Lee-Wong" }] };
    expect(matchesShownName(both, "wong", true)).toBe(false);
  });
  it("matches everyone when there is no search term", () => {
    expect(matchesShownName(livia, "  ", false)).toBe(true);
  });
});
