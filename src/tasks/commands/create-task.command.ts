import { Injectable } from '@nestjs/common';
import { CommandHandler, ICommand, ICommandHandler } from '@nestjs/cqrs';
import { parseTaskDateFromApi, utcTodayStartForDb } from '../../common/utc-datetime';
import { PrismaService } from '../../prisma/prisma.service';
import { TaskResponseDto } from '../dto/task.dto';
import { toTaskResponseDto } from '../task-response.mapper';

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
export class CreateTaskHandler implements ICommandHandler<CreateTaskCommand, TaskResponseDto> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: CreateTaskCommand): Promise<TaskResponseDto> {
    const date = cmd.date ? parseTaskDateFromApi(cmd.date) : utcTodayStartForDb();

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
