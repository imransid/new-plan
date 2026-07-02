import { Injectable, Logger } from "@nestjs/common";
import { DateTime } from "luxon";
import {
  localTaskDayStartForDb,
  utcNowJsDate,
} from "../../common/utc-datetime";
import { PrismaService } from "../../../prisma/prisma.service";
import { DiscordApiService } from "./discord-api.service";
import { MessageFormatterService } from "./message-formatter.service";

export type PostKind = "goal" | "work_update" | "wrap";

export interface PostResult {
  posted: number;
  failed: number;
  results: Array<{
    channelName: string;
    status: "success" | "failed";
    error?: string;
  }>;
}

@Injectable()
export class DiscordPosterService {
  private readonly logger = new Logger(DiscordPosterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: DiscordApiService,
    private readonly formatter: MessageFormatterService,
  ) {}

  // ─── post the morning goal list ─────────────────────────────────────────
  async postGoalList(userId: string): Promise<PostResult> {
    return this.run(userId, "goal");
  }

  // ─── post the work-update list ──────────────────────────────────────────
  async postWorkUpdate(userId: string): Promise<PostResult> {
    return this.run(userId, "work_update");
  }

  // ─── existing daily wrap (kept for backward compat) ─────────────────────
  async postDailyWrap(userId: string): Promise<PostResult> {
    return this.run(userId, "wrap");
  }

  /**
   * Idempotency guard for the scheduler: has a post of this `kind` already
   * succeeded for this user on their *local* calendar day? Used so the
   * catch-up scheduler (which retries every tick until it succeeds) posts at
   * most once per day, and so a duplicate external cron trigger never
   * double-posts. A post counts as "done" once at least one channel delivered
   * (recorded in `PostLog` with status "success").
   */
  async hasSuccessfulPostToday(
    userId: string,
    kind: PostKind,
    timezone: string | null | undefined,
  ): Promise<boolean> {
    const day = localTaskDayStartForDb(timezone);
    const existing = await this.prisma.postLog.findFirst({
      where: { userId, kind, date: day, status: "success" },
      select: { id: true },
    });
    return existing !== null;
  }

  // ─── Shared posting pipeline ────────────────────────────────────────────
  private async run(userId: string, kind: PostKind): Promise<PostResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, timezone: true },
    });
    if (!user) return { posted: 0, failed: 0, results: [] };

    const discordUsername = this.displayNameForDiscord(user);

    // ── BUGFIX ──────────────────────────────────────────────────────────
    // Was: `utcTodayStartForDb()`. That's UTC's "today", which doesn't
    // match the user's "today" for any non-UTC user. The scheduler fires
    // in user-local time (`DateTime.now().setZone(user.timezone)`), so
    // when the scheduler fires we'd query a different calendar day from
    // the one the mobile app stored tasks under, and end up with zero
    // tasks — the silent skip path below would then hide the failure
    // entirely. Use the user's local calendar day instead.
    const today = localTaskDayStartForDb(user.timezone);

    const tasks = await this.prisma.task.findMany({
      where: { userId, date: today },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });

    // Decide which subset of tasks the message should contain.
    let payloadTasks = tasks;
    if (kind === "work_update") {
      payloadTasks = tasks.filter((t) => t.doneAt);
    }

    // Skip silently when there's nothing meaningful to send. We still allow
    // an empty goal list through (useful as a "today's plan is empty" nudge),
    // but we skip work_update / wrap entirely.
    if (kind !== "goal" && payloadTasks.length === 0) {
      this.logger.log(
        `Nothing to post for user ${userId} (${kind}, day=${today
          .toISOString()
          .slice(0, 10)}) — skipping`,
      );
      return { posted: 0, failed: 0, results: [] };
    }

    const connections = await this.prisma.discordConnection.findMany({
      where: { userId },
      include: {
        channels: {
          where: this.channelFilter(kind),
        },
      },
    });

    if (
      connections.length === 0 ||
      connections.every((c) => c.channels.length === 0)
    ) {
      // Useful when debugging "nothing posted" — tells us in the log whether
      // the cause was missing connection vs missing routing flag vs disabled.
      this.logger.warn(
        `No eligible channels for user ${userId} (${kind}). ` +
          `connections=${connections.length}, ` +
          `routing-matched-channels=${connections.reduce(
            (n, c) => n + c.channels.length,
            0,
          )}`,
      );
    }

    // Use the user's local-TZ "today" for the displayed date label too so the
    // header reads e.g. "January 15" matching what the user sees on screen.
    const dateLabel = DateTime.fromJSDate(today, { zone: "utc" }).toFormat(
      "LLLL d",
    );
    const results: PostResult["results"] = [];

    for (const conn of connections) {
      for (const channel of conn.channels) {
        try {
          const payload =
            kind === "goal"
              ? this.formatter.formatGoals(
                  payloadTasks,
                  channel.format,
                  dateLabel,
                )
              : kind === "work_update"
                ? this.formatter.formatWorkUpdate(
                    payloadTasks,
                    channel.format,
                    dateLabel,
                  )
                : this.formatter.format(
                    payloadTasks,
                    channel.format,
                    dateLabel,
                  );

          await this.deliverDiscordMessage(channel, payload, discordUsername);

          await this.prisma.discordChannel.update({
            where: { id: channel.id },
            data: { lastPostedAt: utcNowJsDate(), lastError: null },
          });
          await this.prisma.postLog.create({
            data: {
              userId,
              date: today,
              channelId: channel.channelId,
              channelName: channel.channelName,
              kind,
              status: "success",
            },
          });
          results.push({ channelName: channel.channelName, status: "success" });
        } catch (err: any) {
          const message =
            err?.response?.data?.message ?? err?.message ?? "Unknown error";
          const code = err?.response?.status;
          this.logger.error(
            `Failed posting ${kind} to #${channel.channelName} for user ${userId}: ${message}`,
          );
          await this.prisma.discordChannel.update({
            where: { id: channel.id },
            data: { lastError: message },
          });
          await this.prisma.postLog.create({
            data: {
              userId,
              date: today,
              channelId: channel.channelId,
              channelName: channel.channelName,
              kind,
              status: "failed",
              errorCode: code,
              errorMessage: message,
            },
          });
          results.push({
            channelName: channel.channelName,
            status: "failed",
            error: message,
          });
        }
      }
    }

    const posted = results.filter((r) => r.status === "success").length;
    const failed = results.filter((r) => r.status === "failed").length;
    return { posted, failed, results };
  }

  /** Discord max length for webhook `username`. */
  private displayNameForDiscord(user: {
    name: string | null;
    email: string;
  }): string {
    const trimmed = user.name?.trim();
    if (trimmed) return trimmed.slice(0, 80);
    const local = user.email.split("@")[0] || "DayPlan";
    return local.slice(0, 80);
  }

  /**
   * Posts via an incoming webhook with the user's display name when possible.
   * Falls back to the bot if webhooks are unavailable (missing Manage Webhooks, etc.).
   */
  private async deliverDiscordMessage(
    channel: {
      id: string;
      channelId: string;
      webhookId: string | null;
      webhookToken: string | null;
    },
    payload: { content?: string; embeds?: unknown[] },
    username: string,
  ): Promise<void> {
    try {
      let wid = channel.webhookId;
      let wtoken = channel.webhookToken;

      if (!wid || !wtoken) {
        const w = await this.api.ensurePostingWebhook(channel.channelId);
        wid = w.id;
        wtoken = w.token;
        await this.prisma.discordChannel.update({
          where: { id: channel.id },
          data: { webhookId: wid, webhookToken: wtoken },
        });
      }

      const sendWebhook = () =>
        this.api.executeWebhook(wid!, wtoken!, { ...payload, username });

      try {
        await sendWebhook();
      } catch (err: any) {
        const code = err?.response?.status;
        if (code === 401 || code === 404) {
          await this.prisma.discordChannel.update({
            where: { id: channel.id },
            data: { webhookId: null, webhookToken: null },
          });
          const w = await this.api.ensurePostingWebhook(channel.channelId);
          await this.prisma.discordChannel.update({
            where: { id: channel.id },
            data: { webhookId: w.id, webhookToken: w.token },
          });
          wid = w.id;
          wtoken = w.token;
          await this.api.executeWebhook(wid, wtoken, { ...payload, username });
        } else {
          throw err;
        }
      }
    } catch (err: any) {
      const hint = err?.response?.data?.message ?? err?.message ?? err;
      this.logger.warn(
        `Webhook post as "${username}" failed (${hint}) — using bot`,
      );
      await this.api.postMessage(channel.channelId, payload);
    }
  }

  // Per-kind WHERE clause for channels:
  // - 'goal'        → channels where enabled=true AND postGoals=true
  // - 'work_update' → channels where enabled=true AND postUpdates=true
  // - 'wrap'        → channels where enabled=true (legacy behavior)
  private channelFilter(kind: PostKind) {
    if (kind === "goal") return { enabled: true, postGoals: true };
    if (kind === "work_update") return { enabled: true, postUpdates: true };
    return { enabled: true };
  }
}
