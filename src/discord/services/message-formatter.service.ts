import { Injectable } from "@nestjs/common";
import { ChannelFormat, Task } from "@prisma/client";
import { utcNowIsoString } from "../../common/utc-datetime";

export interface FormattedMessage {
  content?: string;
  embeds?: any[];
}

@Injectable()
export class MessageFormatterService {
  // ─── Existing daily-wrap formatter (kept for backward compat) ──────────
  format(
    tasks: Task[],
    format: ChannelFormat,
    dateLabel: string,
  ): FormattedMessage {
    const done = tasks.filter((t) => t.doneAt);
    const missed = tasks.filter((t) => !t.doneAt);
    const pct =
      tasks.length > 0 ? Math.round((done.length / tasks.length) * 100) : 0;

    switch (format) {
      case "EMBED":
        return this.embed(done, missed, pct, dateLabel);
      case "PLAIN":
        return this.plain(done, missed, pct, dateLabel);
      case "COMPACT":
        return this.compact(done, missed, pct, dateLabel);
      default:
        return this.plain(done, missed, pct, dateLabel);
    }
  }

  // ─── NEW: morning goal post ─────────────────────────────────────────────
  // Format requested by the product:
  //   TODAY GOAL
  //
  //   * task 1
  //   * task 2
  //   * task 3
  formatGoals(
    tasks: Task[],
    format: ChannelFormat,
    dateLabel: string,
  ): FormattedMessage {
    const lines = tasks.map((t) => `* ${t.title}`);

    if (format === "EMBED") {
      return {
        embeds: [
          {
            title: `🎯 TODAY GOAL — ${dateLabel}`,
            description:
              lines.length > 0
                ? lines.join("\n")
                : "_No tasks planned for today._",
            color: 0x5865f2,
            footer: {
              text: `${tasks.length} task${tasks.length === 1 ? "" : "s"} planned`,
            },
            timestamp: utcNowIsoString(),
          },
        ],
      };
    }

    if (format === "COMPACT") {
      return {
        content: `🎯 **TODAY GOAL** — ${tasks.length} task${tasks.length === 1 ? "" : "s"} planned`,
      };
    }

    // PLAIN (default for goal posts) — matches the spec literally
    const out = ["**TODAY GOAL**", "", ...lines];
    return { content: out.join("\n") };
  }

  // ─── NEW: end-of-work-day update post ───────────────────────────────────
  // Format requested by the product:
  //   Work Updated (date)
  //
  //   * task 1
  //   * task 2
  formatWorkUpdate(
    doneTasks: Task[],
    format: ChannelFormat,
    dateLabel: string,
  ): FormattedMessage {
    const lines = doneTasks.map((t) => `* ${t.title}`);

    if (format === "EMBED") {
      return {
        embeds: [
          {
            title: `✅ Work Updated (${dateLabel})`,
            description:
              lines.length > 0 ? lines.join("\n") : "_No tasks completed yet._",
            color: 0x1d9e75,
            footer: { text: `${doneTasks.length} completed` },
            timestamp: utcNowIsoString(),
          },
        ],
      };
    }

    if (format === "COMPACT") {
      return {
        content: `✅ **Work Updated** (${dateLabel}) — ${doneTasks.length} done`,
      };
    }

    // PLAIN
    const out = [`**Work Updated (${dateLabel})**`, "", ...lines];
    return { content: out.join("\n") };
  }

  private embed(
    done: Task[],
    missed: Task[],
    pct: number,
    dateLabel: string,
  ): FormattedMessage {
    const lines = [
      ...done.map((t) => `✓ ${t.title}`),
      ...missed.map((t) => `✗ ${t.title}`),
    ];
    return {
      embeds: [
        {
          title: `📋 Daily wrap — ${dateLabel}`,
          description: lines.join("\n"),
          color: pct >= 80 ? 0x1d9e75 : pct >= 50 ? 0xca8a04 : 0xdc2626,
          footer: {
            text: `${done.length} of ${done.length + missed.length} done · ${pct}%`,
          },
          timestamp: utcNowIsoString(),
        },
      ],
    };
  }

  private plain(
    done: Task[],
    missed: Task[],
    pct: number,
    dateLabel: string,
  ): FormattedMessage {
    const lines = [
      `**Daily wrap — ${dateLabel}**`,
      "",
      ...done.map((t) => `✓ ${t.title}`),
      ...missed.map((t) => `✗ ${t.title}`),
      "",
      `${done.length} of ${done.length + missed.length} done · ${pct}%`,
    ];
    return { content: lines.join("\n") };
  }

  private compact(
    done: Task[],
    missed: Task[],
    pct: number,
    dateLabel: string,
  ): FormattedMessage {
    return {
      content: `📋 ${dateLabel}: **${done.length}/${done.length + missed.length}** done (${pct}%)`,
    };
  }
}
