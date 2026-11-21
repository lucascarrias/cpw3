import type { PlacedSession, Session } from './types';
import { durationMinutes, minutesIntoDay } from './data';

export const PX_PER_MINUTE = 1.7;
export const MIN_CARD_HEIGHT = 44;
export const TIMELINE_PADDING_MIN = 10;

interface Interval {
  session: Session;
  start: number;
  end: number;
}

/**
 * Groups sessions into clusters of transitively overlapping intervals and
 * assigns each one a column with a greedy interval-colouring pass, so
 * simultaneous activities sit side by side.
 */
export function layoutDay(
  sessions: Session[],
  date: string,
): { placed: PlacedSession[]; startMin: number; endMin: number; maxColumns: number } {
  const intervals: Interval[] = sessions
    .map((session) => ({
      session,
      start: minutesIntoDay(session.start, date),
      end: minutesIntoDay(session.end, date),
    }))
    .sort((a, b) => a.start - b.start || b.end - a.end);

  if (!intervals.length) {
    return { placed: [], startMin: 0, endMin: 0, maxColumns: 1 };
  }

  const clusters: Interval[][] = [];
  let current: Interval[] = [];
  let clusterEnd = -Infinity;

  for (const interval of intervals) {
    if (current.length && interval.start >= clusterEnd) {
      clusters.push(current);
      current = [];
      clusterEnd = -Infinity;
    }
    current.push(interval);
    clusterEnd = Math.max(clusterEnd, interval.end);
  }
  if (current.length) clusters.push(current);

  const firstStart = Math.floor((intervals[0].start - TIMELINE_PADDING_MIN) / 30) * 30;
  const lastEnd =
    Math.ceil((Math.max(...intervals.map((interval) => interval.end)) + TIMELINE_PADDING_MIN) / 30) * 30;
  const startMin = Math.max(0, firstStart);
  const endMin = lastEnd;

  const placed: PlacedSession[] = [];
  let maxColumns = 1;
  for (const cluster of clusters) {
    // Continuous/open-space activities (4h+) are packed after the talks so
    // they don't occupy the first, most visible columns of the timeline.
    const ordered = [...cluster].sort((a, b) => {
      const aLong = a.end - a.start >= 240;
      const bLong = b.end - b.start >= 240;
      if (aLong !== bLong) return aLong ? 1 : -1;
      return a.start - b.start || b.end - a.end;
    });

    const columnEnds: number[] = [];
    const assignments: number[] = [];

    for (const interval of ordered) {
      let column = columnEnds.findIndex((end) => end <= interval.start);
      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(interval.end);
      } else {
        columnEnds[column] = interval.end;
      }
      assignments.push(column);
    }

    const columns = columnEnds.length;
    maxColumns = Math.max(maxColumns, columns);
    ordered.forEach((interval, index) => {
      const duration = Math.max(
        MIN_CARD_HEIGHT / PX_PER_MINUTE,
        durationMinutes(interval.session.start, interval.session.end),
      );
      placed.push({
        session: interval.session,
        column: assignments[index],
        columns,
        top: Math.round((interval.start - startMin) * PX_PER_MINUTE),
        height: Math.max(MIN_CARD_HEIGHT, Math.round(duration * PX_PER_MINUTE)),
      });
    });
  }

  return { placed, startMin, endMin, maxColumns };
}
