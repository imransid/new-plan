import { Injectable, NotFoundException } from "@nestjs/common";
import { CommandHandler, ICommand, ICommandHandler } from "@nestjs/cqrs";
import {
  localTaskDayStartForDb,
  localTaskDayYesterdayForDb,
} from "../../common/utc-datetime";
import { PrismaService } from "../../../prisma/prisma.service";
import { TaskResponseDto } from "../dto/task.dto";
import { toTaskResponseDto } from "../task-response.mapper";

/**
 * Copy yesterday's incomplete (`doneAt = null`) tasks into today's task list.
 *
 * Idempotent: if a task with the same title already exists for today (because
 * the rollover already ran, or the user manually recreated it), we skip it.
 * That means the mobile app can call this endpoint freely on every cold-start
 * / day-rollover detection without worrying about duplicates.
 *
 * "Today" and "yesterday" are computed in the user's timezone, not UTC, so
 * the rollover lines up with what the user thinks of as the day boundary.
 */
export class RolloverTasksCommand implements ICommand {
  constructor(public readonly userId: string) {}
}

export interface RolloverResult {
  copied: number;
  skipped: number;
  tasks: TaskResponseDto[];
}

@Injectable()
@CommandHandler(RolloverTasksCommand)
export class RolloverTasksHandler
  implements ICommandHandler<RolloverTasksCommand, RolloverResult>
{
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: RolloverTasksCommand): Promise<RolloverResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: cmd.userId },
      select: { timezone: true },
    });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const today = localTaskDayStartForDb(user.timezone);
    const yesterday = localTaskDayYesterdayForDb(user.timezone);

    const yesterdayIncomplete = await this.prisma.task.findMany({
      where: { userId: cmd.userId, date: yesterday, doneAt: null },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });

    if (yesterdayIncomplete.length === 0) {
      return { copied: 0, skipped: 0, tasks: [] };
    }

    const existingToday = await this.prisma.task.findMany({
      where: { userId: cmd.userId, date: today },
      select: { title: true, position: true },
    });
    // Dedupe key is title — that's the only thing the user actually identifies
    // a task by. If they already retyped it manually we don't want a duplicate.
    const existingTitles = new Set(existingToday.map((t) => t.title));
    let nextPosition = existingToday.length;

    const created: TaskResponseDto[] = [];
    let skipped = 0;

    for (const t of yesterdayIncomplete) {
      if (existingTitles.has(t.title)) {
        skipped++;
        continue;
      }
      const row = await this.prisma.task.create({
        data: {
          userId: cmd.userId,
          title: t.title,
          date: today,
          position: nextPosition++,
        },
      });
      created.push(toTaskResponseDto(row));
      existingTitles.add(t.title); // guard against same-title twice within yesterday
    }

    return { copied: created.length, skipped, tasks: created };
  }
}
