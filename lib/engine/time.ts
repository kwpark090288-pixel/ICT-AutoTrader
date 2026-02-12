export function toIsoUtc(ms: number): string {
  const iso = new Date(ms).toISOString();
  return iso.replace(/\.\d{3}Z$/, "Z");
}

