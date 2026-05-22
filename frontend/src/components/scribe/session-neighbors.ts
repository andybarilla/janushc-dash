export interface Neighbors {
  prev: string | null;
  next: string | null;
}

export function findNeighbors(
  orderedIds: string[],
  currentId: string,
): Neighbors {
  const i = orderedIds.indexOf(currentId);
  if (i === -1) return { prev: null, next: null };
  return {
    prev: orderedIds[i - 1] ?? null,
    next: orderedIds[i + 1] ?? null,
  };
}
