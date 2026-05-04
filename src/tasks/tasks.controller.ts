import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { CreateTaskDto, UpdateTaskDto, TaskResponseDto } from './dto/task.dto';
import { CreateTaskCommand } from './commands/create-task.command';
import { ToggleTaskCommand } from './commands/toggle-task.command';
import { UpdateTaskCommand, DeleteTaskCommand } from './commands/update-delete-task.command';
import { GetTasksByDateQuery, GetTasksHistoryQuery } from './queries/get-tasks.query';

@ApiTags('Tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a task for today (or a specific date)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTaskDto): Promise<TaskResponseDto> {
    return this.commandBus.execute(
      new CreateTaskCommand(user.userId, dto.title, dto.date, dto.position),
    );
  }

  @Get()
  @ApiOperation({ summary: 'Get tasks for a specific date (default: today)' })
  list(
    @CurrentUser() user: AuthUser,
    @Query('date') date?: string,
  ): Promise<TaskResponseDto[]> {
    const target = date?.trim() || undefined;
    return this.queryBus.execute(new GetTasksByDateQuery(user.userId, target));
  }

  @Get('history')
  @ApiOperation({ summary: 'Get tasks grouped by date for a range' })
  history(
    @CurrentUser() user: AuthUser,
    @Query('from') from: string,
    @Query('to') to: string,
  ): Promise<Record<string, TaskResponseDto[]>> {
    return this.queryBus.execute(new GetTasksHistoryQuery(user.userId, from, to));
  }

  @Patch(':id/toggle')
  @ApiOperation({ summary: 'Toggle a task done/undone' })
  toggle(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<TaskResponseDto> {
    return this.commandBus.execute(new ToggleTaskCommand(user.userId, id));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update task title or position' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ): Promise<TaskResponseDto> {
    return this.commandBus.execute(
      new UpdateTaskCommand(user.userId, id, dto.title, dto.position),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a task' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    return this.commandBus.execute(new DeleteTaskCommand(user.userId, id));
  }
}
