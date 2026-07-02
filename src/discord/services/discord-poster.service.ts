import { Injectable, Logger } from "@nestjs/common";
import { DateTime } from "luxon";
import {
  localTaskDayStartForDb,
  utcNowJsDate,
} from "../../common/utc-datetime";
import { PrismaService } from "../../../prisma/prisma.service";
import { ChannelFormat } from "../../../prisma/generated/prisma/client";
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

  // ─── Team / shared channel pass ─────────────────────────────────────────
  /**
   * Post this user's due goal/work-update into every shared ("team") channel
   * they've joined, attributed to them via the webhook username (the owner's
   * bot posts on their behalf — the member needs no Discord connection).
   *
   * Independent of the personal path and idempotent per
   * (user, shared channel, kind, local day) via SharedChannelPostLog, so it is
   * safe to call every scheduler tick and it survives missed minutes.
   */
  async postToSharedChannels(
    userId: string,
    kind: PostKind,
  ): Promise<PostResult> {
    // Cheapest gate first: most users aren't in any team channel, so skip all
    // other work for them.
    const memberships = await this.prisma.sharedChannelMember.findMany({
      where: {
        userId,
        enabled: true,
        sharedChannel: {
          enabled: true,
          ...(kind === "goal" ? { postGoals: true } : { postUpdates: true }),
        },
      },
      include: { sharedChannel: true },
    });
    if (memberships.length === 0) return { posted: 0, failed: 0, results: [] };

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, timezone: true },
    });
    if (!user) return { posted: 0, failed: 0, results: [] };

    const username = this.displayNameForDiscord(user);
    const today = localTaskDayStartForDb(user.timezone);

    const tasks = await this.prisma.task.findMany({
      where: { userId, date: today },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    const payloadTasks =
      kind === "work_update" ? tasks.filter((t) => t.doneAt) : tasks;
    // Skip empty work-updates (same rule as personal); empty goal lists still
    // post as a "plan is empty" nudge.
    if (kind !== "goal" && payloadTasks.length === 0) {
      return { posted: 0, failed: 0, results: [] };
    }

    const dateLabel = DateTime.fromJSDate(today, { zone: "utc" }).toFormat(
      "LLLL d",
    );
    const results: PostResult["results"] = [];

    for (const m of memberships) {
      const sc = m.sharedChannel;

      // Per-(member, shared channel, kind, day) idempotency.
      const already = await this.prisma.sharedChannelPostLog.findFirst({
        where: {
          sharedChannelId: sc.id,
          userId,
          kind,
          date: today,
          status: "success",
        },
        select: { id: true },
      });
      if (already) continue;

      try {
        const payload =
          kind === "goal"
            ? this.formatter.formatGoals(
                payloadTasks,
                ChannelFormat.EMBED,
                dateLabel,
              )
            : this.formatter.formatWorkUpdate(
                payloadTasks,
                ChannelFormat.EMBED,
                dateLabel,
              );

        await this.deliverDiscordMessage(
          {
            id: sc.id,
            channelId: sc.channelId,
            webhookId: sc.webhookId,
            webhookToken: sc.webhookToken,
          },
          payload,
          username,
          (wid, wtoken) =>
            this.prisma.sharedChannel.update({
              where: { id: sc.id },
              data: { webhookId: wid, webhookToken: wtoken },
            }),
        );

        await this.prisma.sharedChannel.update({
          where: { id: sc.id },
          data: { lastError: null },
        });
        await this.prisma.sharedChannelPostLog.create({
          data: {
            sharedChannelId: sc.id,
            userId,
            date: today,
            kind,
            status: "success",
          },
        });
        results.push({ channelName: sc.channelName, status: "success" });
      } catch (err: any) {
        const message =
          err?.response?.data?.message ?? err?.message ?? "Unknown error";
        const code = err?.response?.status;
        this.logger.error(
          `Failed posting ${kind} to shared #${sc.channelName} for user ${userId}: ${message}`,
        );
        await this.prisma.sharedChannel.update({
          where: { id: sc.id },
          data: { lastError: message },
        });
        await this.prisma.sharedChannelPostLog.create({
          data: {
            sharedChannelId: sc.id,
            userId,
            date: today,
            kind,
            status: "failed",
            errorCode: code,
            errorMessage: message,
          },
        });
        results.push({
          channelName: sc.channelName,
          status: "failed",
          error: message,
        });
      }

      // Stagger sends so many members hitting the same channel within one
      // minute stay well under Discord's ~5 msg / 5 s per-channel ceiling.
      await this.sleep(400);
    }

    const posted = results.filter((r) => r.status === "success").length;
    const failed = results.filter((r) => r.status === "failed").length;
    return { posted, failed, results };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    // Where to persist a (re)issued webhook. Personal channels default to the
    // DiscordChannel row; shared channels pass a SharedChannel updater. This is
    // the ONLY difference between the personal and team delivery paths.
    updateWebhook?: (
      webhookId: string | null,
      webhookToken: string | null,
    ) => Promise<unknown>,
  ): Promise<void> {
    const persist =
      updateWebhook ??
      ((wid: string | null, wtoken: string | null) =>
        this.prisma.discordChannel.update({
          where: { id: channel.id },
          data: { webhookId: wid, webhookToken: wtoken },
        }));
    try {
      let wid = channel.webhookId;
      let wtoken = channel.webhookToken;

      if (!wid || !wtoken) {
        const w = await this.api.ensurePostingWebhook(channel.channelId);
        wid = w.id;
        wtoken = w.token;
        await persist(wid, wtoken);
      }

      const sendWebhook = () =>
        this.api.executeWebhook(wid!, wtoken!, { ...payload, username });

      try {
        await sendWebhook();
      } catch (err: any) {
        const code = err?.response?.status;
        if (code === 401 || code === 404) {
          await persist(null, null);
          const w = await this.api.ensurePostingWebhook(channel.channelId);
          await persist(w.id, w.token);
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
