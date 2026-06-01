/**
 * Recompute schedule_items.start_at after reorder or duration change.
 * Uses duration_ms + transition_ms (black gap is modeled as gap items or transition_ms).
 */

export type TimelineItem = {
  id?: string;
  position: number;
  duration_ms: number;
  transition_ms: number;
  start_at?: string;
};

export function recomputeStartTimes(
  items: TimelineItem[],
  dayStart: Date,
): Array<TimelineItem & { start_at: string }> {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  let cursor = dayStart.getTime();
  return sorted.map((item) => {
    const start_at = new Date(cursor).toISOString();
    cursor += item.duration_ms + item.transition_ms;
    return { ...item, start_at };
  });
}

/** Default gap between videos when auto-inserting black screens (ms). */
export const DEFAULT_SCHEDULE_GAP_MS = 1500;
