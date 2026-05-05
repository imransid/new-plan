import { Injectable, NotFoundException } from "@nestjs/common";
import { IQuery, IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import {
  parseTaskDateFromApi,
  utcCalendarDateKey,
  localTaskDayStartForDb,
} from "../../common/utc-datetime";
import { PrismaService } from "../../../prisma/prisma.service";
import { TaskResponseDto } from "../dto/task.dto";
import { toTaskResponseDto } from "../task-response.mapper";

export class GetTasksByDateQuery implements IQuery {
  constructor(
    public readonly userId: string,
    /** ISO UTC / YYYY-MM-DD, or omit for current LOCAL calendar day */
    public readonly date?: string,
  ) {}
}

@Injectable()
@QueryHandler(GetTasksByDateQuery)
export class GetTasksByDateHandler implements IQueryHandler<
  GetTasksByDateQuery,
  TaskResponseDto[]
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: GetTasksByDateQuery): Promise<TaskResponseDto[]> {
    const trimmed = query.date?.trim();

    let date: Date;
    if (trimmed) {
      date = parseTaskDateFromApi(trimmed);
    } else {
      // No date param → today in the user's local TZ (not UTC). Same reasoning
      // as create-task: a user in Dhaka opening the app at 1am should see
      // their Dhaka-Jan-15 tasks, not Jan-14 (which is what UTC would say).
      const user = await this.prisma.user.findUnique({
        where: { id: query.userId },
        select: { timezone: true },
      });
      if (!user) {
        throw new NotFoundException("User not found");
      }
      date = localTaskDayStartForDb(user.timezone);
    }

    const tasks = await this.prisma.task.findMany({
      where: { userId: query.userId, date },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });

    return tasks.map((t) => toTaskResponseDto(t));
  }
}

export class GetTasksHistoryQuery implements IQuery {
  constructor(
    public readonly userId: string,
    public readonly fromDate: string,
    public readonly toDate: string,
  ) {}
}

@Injectable()
@QueryHandler(GetTasksHistoryQuery)
export class GetTasksHistoryHandler implements IQueryHandler<
  GetTasksHistoryQuery,
  Record<string, TaskResponseDto[]>
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    query: GetTasksHistoryQuery,
  ): Promise<Record<string, TaskResponseDto[]>> {
    const from = parseTaskDateFromApi(query.fromDate);
    const to = parseTaskDateFromApi(query.toDate);

    const tasks = await this.prisma.task.findMany({
      where: { userId: query.userId, date: { gte: from, lte: to } },
      orderBy: [{ date: "desc" }, { position: "asc" }],
    });

    const grouped: Record<string, TaskResponseDto[]> = {};
    for (const t of tasks) {
      const dateKey = utcCalendarDateKey(t.date);
      grouped[dateKey] ??= [];
      grouped[dateKey].push(toTaskResponseDto(t));
    }
    return grouped;
  }
}
