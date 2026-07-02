import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DateTime } from "luxon";
import { PrismaService } from "../../prisma/prisma.service";
import {
  DiscordPosterService,
  PostKind,
} from "../discord/services/discord-poster.service";

/**
 * Whether to run the every-minute posting loop *inside this process*.
 *
 * The in-process `@Cron` only fires while a Node process is alive and ticking.
 * On a sleeping free tier (e.g. Render free spins down when idle) or a
 * serverless runtime there is no such process, so scheduled posts never go out.
 * In those environments leave this off and drive posting from the secured HTTP
 * endpoint (`POST /api/internal/cron/run-due-posts`) via an external scheduler.
 *
 * Posting is idempotent per (user, kind, local-day), so it is safe to enable
 * BOTH the in-process cron and the external trigger — the second one just no-ops.
 */
function inProcessCronEnabled(): boolean {
  return process.env.ENABLE_INPROCESS_CRON === "true";
}

export interface RunDuePostsSummary {
  ranAt: string;
  usersConsidered: number;
  goalPosted: number;
  workUpdatePosted: number;
  skipped: number;
  errors: number;
}

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  /**
   * Guards against overlapping runs — a slow run (many users) plus the next
   * minute tick or a duplicate HTTP trigger would otherwise contend on the DB
   * pool and race on the idempotency check.
   */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly discordPoster: DiscordPosterService,
  ) {}

  /**
   * In-process every-minute tick. No-ops unless `ENABLE_INPROCESS_CRON=true`,
   * so the same build can run on an always-on host (flag on) or behind an
   * external cron (flag off) without code changes.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleCronTick(): Promise<void> {
    if (!inProcessCronEnabled()) return;
    try {
      await this.runDuePosts();
    } catch (err) {
      // @nestjs/schedule discards the returned promise, so an unhandled
      // rejection here would vanish silently. Log it ourselves.
      this.logger.error("In-process cron tick failed", err as Error);
    }
  }

  /**
   * Post any goal / work-update messages that are DUE and not yet posted today.
   * Trigger-agnostic: invoked by the in-process `@Cron` AND the HTTP cron
   * endpoint.
   *
   * Uses a catch-up window (`localTime >= scheduledTime`) combined with
   * per-(user, kind, local-day) idempotency instead of exact-minute equality.
   * That way a missed minute (sleep, cold start, restart, deploy, a slow tick)
   * still posts once — later that same local day — rather than being lost until
   * tomorrow, and a re-trigger never double-posts.
   */
  async runDuePosts(): Promise<RunDuePostsSummary> {
    const ranAt = DateTime.utc().toISO()!;
    const summary: RunDuePostsSummary = {
      ranAt,
      usersConsidered: 0,
      goalPosted: 0,
      workUpdatePosted: 0,
      skipped: 0,
      errors: 0,
    };

    if (this.running) {
      this.logger.warn("runDuePosts skipped — previous run still in progress");
      return summary;
    }
    this.running = true;

    try {
      let users: Array<{
        id: string;
        email: string;
        timezone: string;
        goalPostTime: string;
        workUpdateTime: string;
      }>;
      try {
        users = await this.prisma.user.findMany({
          select: {
            id: true,
            email: true,
            timezone: true,
            goalPostTime: true,
            workUpdateTime: true,
          },
        });
      } catch (err) {
        // Previously this awaited *outside* any try/catch, so a DB blip or a
        // schema drift rejected the whole tick with zero log output — a classic
        // silent "nothing ever posts". Surface it and end the run cleanly.
        this.logger.error(
          "runDuePosts: failed to load users — aborting this run",
          err as Error,
        );
        summary.errors++;
        return summary;
      }

      summary.usersConsidered = users.length;

      for (const user of users) {
        // Defensive: a bad timezone string ("Asia/Dahka") makes `setZone`
        // invalid and `toFormat` return "Invalid DateTime", which would never
        // match. Skip and warn instead.
        const local = DateTime.now().setZone(user.timezone);
        if (!local.isValid) {
          this.logger.warn(
            `User ${user.email} has invalid timezone "${user.timezone}" — skipping`,
          );
          continue;
        }
        // Zero-padded 24h "HH:mm" — safe to compare lexically against the
        // equally-padded goalPostTime/workUpdateTime strings.
        const localTime = local.toFormat("HH:mm");

        if (user.goalPostTime && localTime >= user.goalPostTime) {
          await this.fireIfNotPosted(user, "goal", summary);
        }
        if (user.workUpdateTime && localTime >= user.workUpdateTime) {
          await this.fireIfNotPosted(user, "work_update", summary);
        }
      }

      return summary;
    } finally {
      this.running = false;
    }
  }

  /**
   * Post one kind for one user unless it already succeeded today (idempotency).
   * Never throws — a single user's failure must not abort the whole run.
   */
  private async fireIfNotPosted(
    user: { id: string; email: string; timezone: string },
    kind: PostKind,
    summary: RunDuePostsSummary,
  ): Promise<void> {
    try {
      const already = await this.discordPoster.hasSuccessfulPostToday(
        user.id,
        kind,
        user.timezone,
      );
      if (already) {
        summary.skipped++;
        return;
      }

      const result =
        kind === "goal"
          ? await this.discordPoster.postGoalList(user.id)
          : await this.discordPoster.postWorkUpdate(user.id);

      if (result.posted > 0) {
        if (kind === "goal") summary.goalPosted++;
        else summary.workUpdatePosted++;
        this.logger.log(
          `[${kind}] User ${user.email}: posted ${result.posted}, failed ${result.failed}`,
        );
      } else {
        // Nothing delivered (no eligible channel, or an empty work-update that
        // is skipped by design). Not counted as posted; will retry next tick
        // until it succeeds or the local day rolls over.
        summary.skipped++;
        if (result.failed > 0) {
          this.logger.warn(
            `[${kind}] User ${user.email}: 0 posted, ${result.failed} failed`,
          );
        }
      }
    } catch (err) {
      summary.errors++;
      this.logger.error(`[${kind}] Failed for user ${user.email}`, err as Error);
    }
  }
}
