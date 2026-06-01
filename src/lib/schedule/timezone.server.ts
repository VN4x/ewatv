const DEFAULT_TZ = "Europe/Helsinki";

export function getAutopilotTimezone(): string {
  return process.env.AUTOPILOT_TIMEZONE ?? DEFAULT_TZ;
}

/** Calendar date yyyy-MM-dd in the given IANA timezone. */
export function calendarDateInTz(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function getTodayInAutopilotTz(now = new Date()): string {
  return calendarDateInTz(now, getAutopilotTimezone());
}

export function getTomorrowInAutopilotTz(now = new Date()): string {
  return calendarDateInTz(new Date(now.getTime() + 86400000), getAutopilotTimezone());
}

export function hourInTz(instant: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hour12: false,
    }).format(instant),
  );
}

/** UTC epoch ms for local midnight at the start of calendar date in timeZone. */
export function startOfCalendarDayMs(dateStr: string, timeZone: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  let probe = Date.UTC(y, m - 1, d, 12, 0, 0);
  for (let i = 0; i < 48; i++) {
    const h = hourInTz(new Date(probe), timeZone);
    if (h === 0) {
      const minute = Number(
        new Intl.DateTimeFormat("en-US", {
          timeZone,
          minute: "numeric",
        }).format(new Date(probe)),
      );
      if (minute === 0) return probe;
    }
    probe -= 3600000;
  }
  return Date.UTC(y, m - 1, d, 0, 0, 0);
}

export type SlotDaypart = "primetime" | "night" | "day";

/** Local hour → scheduling slot (plan: primetime 18–23, night 23–06, any fills day 06–18). */
export function slotForLocalHour(hour: number): SlotDaypart {
  if (hour >= 18 && hour < 23) return "primetime";
  if (hour >= 23 || hour < 6) return "night";
  return "day";
}
