import { Injectable, NotFoundException } from "@nestjs/common";
import { CommandHandler, ICommand, ICommandHandler } from "@nestjs/cqrs";
import {
  parseTaskDateFromApi,
  localTaskDayStartForDb,
} from "../../common/utc-datetime";
import { PrismaService } from "../../../prisma/prisma.service";
import { TaskResponseDto } from "../dto/task.dto";
import { toTaskResponseDto } from "../task-response.mapper";

export class CreateTaskCommand implements ICommand {
  constructor(
    public readonly userId: string,
    public readonly title: string,
    public readonly date?: string,
    public readonly position?: number,
  ) {}
}

@Injectable()
@CommandHandler(CreateTaskCommand)
export class CreateTaskHandler implements ICommandHandler<
  CreateTaskCommand,
  TaskResponseDto
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: CreateTaskCommand): Promise<TaskResponseDto> {
    let date: Date;
    if (cmd.date) {
      date = parseTaskDateFromApi(cmd.date);
    } else {
      // No date passed → "today" must mean the user's calendar day, not UTC's.
      // Otherwise a task created at 1am Dhaka silently lands on yesterday.
      const user = await this.prisma.user.findUnique({
        where: { id: cmd.userId },
        select: { timezone: true },
      });
      if (!user) {
        throw new NotFoundException("User not found");
      }
      date = localTaskDayStartForDb(user.timezone);
    }

    const position =
      cmd.position ??
      (await this.prisma.task.count({
        where: { userId: cmd.userId, date },
      }));

    const task = await this.prisma.task.create({
      data: {
        userId: cmd.userId,
        title: cmd.title,
        date,
        position,
      },
    });

    return toTaskResponseDto(task);
  }
}
