/** Strip ilike wildcards and cap length for safe video search queries. */
export function sanitizeSearch(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined;
  return raw.trim().slice(0, 200).replace(/[%_\\]/g, "");
}
