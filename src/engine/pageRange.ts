export interface ParsedRangeGroup {
  label: string;
  pageIndices: number[]; // 0-based indices into current pages array
}

/**
 * Parses a page range expression such as "1-3, 5, 8-10" against totalPages.
 * Returns 0-based sorted/ordered indices without duplicates when `flatten` is true,
 * or separate groups per comma-separated token for multi-file splitting.
 */
export function parsePageRangeExpression(
  input: string,
  totalPages: number,
): { groups: ParsedRangeGroup[]; allIndices: number[]; error?: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { groups: [], allIndices: [], error: 'Enter at least one page number or range.' };
  }
  if (totalPages <= 0) {
    return { groups: [], allIndices: [], error: 'Document has no pages.' };
  }

  const tokens = trimmed
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return { groups: [], allIndices: [], error: 'Invalid page range syntax.' };
  }

  const groups: ParsedRangeGroup[] = [];
  const seen = new Set<number>();
  const allIndices: number[] = [];

  for (const token of tokens) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(token);
    if (!match) {
      return {
        groups: [],
        allIndices: [],
        error: `Invalid range token "${token}". Use formats like "1-3, 5".`,
      };
    }
    const start = Number.parseInt(match[1], 10);
    const end = match[2] ? Number.parseInt(match[2], 10) : start;

    if (start < 1 || end < 1 || start > totalPages || end > totalPages) {
      return {
        groups: [],
        allIndices: [],
        error: `Page numbers must be between 1 and ${totalPages}.`,
      };
    }

    const step = start <= end ? 1 : -1;
    const groupIndices: number[] = [];
    for (let p = start; step > 0 ? p <= end : p >= end; p += step) {
      const zeroIdx = p - 1;
      groupIndices.push(zeroIdx);
      if (!seen.has(zeroIdx)) {
        seen.add(zeroIdx);
        allIndices.push(zeroIdx);
      }
    }

    groups.push({
      label: match[2] ? `${start}-${end}` : `${start}`,
      pageIndices: groupIndices,
    });
  }

  return { groups, allIndices };
}
