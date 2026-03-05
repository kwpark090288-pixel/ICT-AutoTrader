export function compareLexicographic(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function uniqueLexicographicTags(tags: readonly string[]): string[] {
  return Array.from(new Set(tags)).sort(compareLexicographic);
}

export function formatTags(tags: readonly string[]): string {
  return uniqueLexicographicTags(tags).join("|");
}
