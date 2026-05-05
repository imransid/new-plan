import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { TasksController } from "./tasks.controller";
import { CreateTaskHandler } from "./commands/create-task.command";
import { ToggleTaskHandler } from "./commands/toggle-task.command";
import {
  UpdateTaskHandler,
  DeleteTaskHandler,
} from "./commands/update-delete-task.command";
import { RolloverTasksHandler } from "./commands/rollover-tasks.command";
import {
  GetTasksByDateHandler,
  GetTasksHistoryHandler,
} from "./queries/get-tasks.query";

const Handlers = [
  CreateTaskHandler,
  ToggleTaskHandler,
  UpdateTaskHandler,
  DeleteTaskHandler,
  RolloverTasksHandler,
  GetTasksByDateHandler,
  GetTasksHistoryHandler,
];

@Module({
  imports: [CqrsModule],
  controllers: [TasksController],
  providers: [...Handlers],
})
export class TasksModule {}
