import { BadRequestException } from "@nestjs/common";
import { DateTime } from "luxon";

/**
 * Task `date` (@db.Date) stores a CALENDAR DAY in the user's local timezone,
 * represented as that day's UTC midnight. So a task for "Jan 15 in Dhaka"
 * is stored as `2025-01-15T00:00:00Z`. Postgres `@db.Date` keeps only the
 * `YYYY-MM-DD` portion, so this representation lines up cleanly across all
 * client/server timezones as long as both sides use the *same* calendar day.
 *
 * Old code used UTC-day everywhere, which silently broke for any user not on
 * UTC: at certain hours their "today" disagreed with the server's "today",
 * and the Discord scheduler queried the wrong day.
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

/**
 * Calendar day "today" *in the given IANA timezone*, expressed as that day's
 * UTC-midnight JS Date for use in Prisma @db.Date filters. Falls back to UTC
 * day if the timezone is missing or invalid (defensive — bogus timezones
 * shouldn't silently break posting).
 */
export function localTaskDayStartForDb(
  timezone: string | null | undefined,
): Date {
  const zone =
    timezone && DateTime.now().setZone(timezone).isValid ? timezone : "utc";
  const ymd = DateTime.now().setZone(zone).toISODate(); // "YYYY-MM-DD" in user's TZ
  if (!ymd) {
    return DateTime.utc().startOf("day").toJSDate();
  }
  return DateTime.fromISO(ymd, { zone: "utc" }).toJSDate();
}

/** Same as above but for "yesterday" — used by the day-rollover endpoint. */
export function localTaskDayYesterdayForDb(
  timezone: string | null | undefined,
): Date {
  const today = localTaskDayStartForDb(timezone);
  return DateTime.fromJSDate(today, { zone: "utc" })
    .minus({ days: 1 })
    .toJSDate();
}

/** Current UTC calendar day at 00:00 UTC. Kept for any non-task uses (logs, etc.). */
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
  const iso = DateTime.fromJSDate(d)
    .toUTC()
    .toISO({ suppressMilliseconds: true });
  return iso ?? null;
}

/** "Now" as JS Date (UTC instant) for writes like `doneAt`. */
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

/**
 * Cheap IANA timezone validator — used by the `/users/me` PATCH so a typo'd
 * timezone can't silently disable the scheduler for that user. (Old code only
 * checked `@IsString()`, so "Asia/Dahka" would save fine and then never
 * trigger any post.)
 */
export function isValidIanaTimezone(tz: string): boolean {
  return DateTime.now().setZone(tz).isValid;
}
