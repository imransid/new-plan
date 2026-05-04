import { BadRequestException } from "@nestjs/common";
import { DateTime } from "luxon";

/**
 * All task calendar days and API timestamps use **UTC** via Luxon.
 * Task `date` (@db.Date) is the UTC calendar day; API serializes it as
 * `T00:00:00.000Z` ISO strings.
 */

/** Parse `YYYY-MM-DD` or full ISO; always interpreted as UTC start-of-day (Prisma @db.Date). */
export function parseTaskDateFromApi(input: string): Date {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new BadRequestException("date is required");
  }
  const dt = DateTime.fromISO(trimmed, { zone: "utc" });
  if (!dt.isValid) {
    throw new BadRequestException("Invalid date");
  }
  return dt.startOf("day").toJSDate();
}

/** Current UTC calendar day at 00:00 UTC (for Prisma `date` filters). */
export function utcTodayStartForDb(): Date {
  return DateTime.utc().startOf("day").toJSDate();
}

/** Task row `date` field → API ISO (midnight UTC that calendar day). */
export function utcTaskDayToIsoResponse(d: Date): string {
  const iso = DateTime.fromJSDate(d, { zone: "utc" })
    .startOf("day")
    .toISO({ suppressMilliseconds: true });
  if (!iso) {
    throw new Error("Invalid task date for serialization");
  }
  return iso;
}

/** `doneAt` / instants → ISO UTC (preserves wall time as stored in DB). */
export function instantToIsoUtcNullable(d: Date | null): string | null {
  if (!d) return null;
  const iso = DateTime.fromJSDate(d).toUTC().toISO({ suppressMilliseconds: true });
  return iso ?? null;
}

/** “Now” as JS Date (UTC instant) for writes like `doneAt`. */
export function utcNowJsDate(): Date {
  return DateTime.utc().toJSDate();
}

/** Grouping key for history: `YYYY-MM-DD` in UTC (object keys). */
export function utcCalendarDateKey(d: Date): string {
  const key = DateTime.fromJSDate(d, { zone: "utc" }).toISODate();
  if (!key) {
    throw new Error("Invalid date for key");
  }
  return key;
}

/** Discord embed timestamps (ISO UTC). */
export function utcNowIsoString(): string {
  return DateTime.utc().toISO({ suppressMilliseconds: true })!;
}
