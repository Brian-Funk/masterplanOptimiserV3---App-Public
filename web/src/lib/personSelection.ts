type PersonSelectionItem = number | string | { id?: unknown; type?: string };

/** Return a numeric person ID from a scalar or object selection value. */
export function getPersonSelectionId(item: PersonSelectionItem): number | null {
  const rawId = typeof item === "object" && item !== null ? item.id : item;
  const id =
    typeof rawId === "number"
      ? rawId
      : typeof rawId === "string" && rawId.trim() !== ""
        ? Number(rawId)
        : NaN;

  return Number.isInteger(id) ? id : null;
}

/** Return unique person IDs while preserving their first-seen order. */
export function dedupePersonSelectionIds(
  items: PersonSelectionItem[] | null | undefined,
): number[] {
  const seen = new Set<number>();
  const result: number[] = [];

  for (const item of items || []) {
    const id = getPersonSelectionId(item);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }

  return result;
}

/** Merge existing and imported person selections without duplicating IDs. */
export function mergePersonSelectionIds(
  current: PersonSelectionItem[] | null | undefined,
  incoming: PersonSelectionItem[] | null | undefined,
): number[] {
  return dedupePersonSelectionIds([
    ...dedupePersonSelectionIds(current),
    ...dedupePersonSelectionIds(incoming),
  ]);
}

/** Remove one or more person IDs from an existing selection. */
export function removePersonSelectionIds(
  current: PersonSelectionItem[] | null | undefined,
  idsToRemove: PersonSelectionItem[] | null | undefined,
): number[] {
  const blocked = new Set(dedupePersonSelectionIds(idsToRemove));
  return dedupePersonSelectionIds(current).filter((id) => !blocked.has(id));
}
