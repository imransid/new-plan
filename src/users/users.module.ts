import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";
import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString, Matches } from "class-validator";
import {
  CommandHandler,
  ICommand,
  ICommandHandler,
  IQuery,
  IQueryHandler,
  QueryHandler,
  CommandBus,
  QueryBus,
} from "@nestjs/cqrs";
import { Injectable } from "@nestjs/common";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import {
  CurrentUser,
  AuthUser,
} from "../common/decorators/current-user.decorator";
import { PrismaService } from "../prisma/prisma.service";

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

class UpdateProfileDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() timezone?: string;
  // Legacy — kept so older clients don't 400. New clients should use goalPostTime/workUpdateTime.
  @IsString() @IsOptional() @Matches(TIME_REGEX) endOfDayTime?: string;
  // New: when to post "TODAY GOAL" (all today's tasks)
  @IsString() @IsOptional() @Matches(TIME_REGEX) goalPostTime?: string;
  // New: when to post "Work Updated" (only completed tasks)
  @IsString() @IsOptional() @Matches(TIME_REGEX) workUpdateTime?: string;
}

class UpdateScheduleDto {
  @IsString() @IsOptional() @Matches(TIME_REGEX) startTime?: string;
  @IsString() @IsOptional() @Matches(TIME_REGEX) endTime?: string;
  @IsBoolean() @IsOptional() hourlyEnabled?: boolean;
  @IsBoolean() @IsOptional() endOfDayEnabled?: boolean;
}

// Shared select for /me responses so query + mutation always agree.
const userResponseSelect = {
  id: true,
  email: true,
  name: true,
  timezone: true,
  endOfDayTime: true,
  goalPostTime: true,
  workUpdateTime: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ─── Query: get me ───────────────────────────────────────────
class GetMeQuery implements IQuery {
  constructor(public readonly userId: string) {}
}

@Injectable()
@QueryHandler(GetMeQuery)
class GetMeHandler implements IQueryHandler<GetMeQuery> {
  constructor(private readonly prisma: PrismaService) {}
  async execute(q: GetMeQuery) {
    return this.prisma.user.findUnique({
      where: { id: q.userId },
      select: { ...userResponseSelect, reminderSchedule: true },
    });
  }
}

// ─── Command: update profile ─────────────────────────────────
class UpdateProfileCommand implements ICommand {
  constructor(
    public readonly userId: string,
    public readonly dto: UpdateProfileDto,
  ) {}
}

@Injectable()
@CommandHandler(UpdateProfileCommand)
class UpdateProfileHandler implements ICommandHandler<UpdateProfileCommand> {
  constructor(private readonly prisma: PrismaService) {}
  async execute(c: UpdateProfileCommand) {
    return this.prisma.user.update({
      where: { id: c.userId },
      data: c.dto,
      select: userResponseSelect,
    });
  }
}

// ─── Command: update schedule ────────────────────────────────
class UpdateScheduleCommand implements ICommand {
  constructor(
    public readonly userId: string,
    public readonly dto: UpdateScheduleDto,
  ) {}
}

@Injectable()
@CommandHandler(UpdateScheduleCommand)
class UpdateScheduleHandler implements ICommandHandler<UpdateScheduleCommand> {
  constructor(private readonly prisma: PrismaService) {}
  async execute(c: UpdateScheduleCommand) {
    return this.prisma.reminderSchedule.upsert({
      where: { userId: c.userId },
      update: c.dto,
      create: { userId: c.userId, ...c.dto },
    });
  }
}

// ─── Controller ──────────────────────────────────────────────
@ApiTags("Users")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("users")
class UsersController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.queryBus.execute(new GetMeQuery(user.userId));
  }

  @Patch("me")
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.commandBus.execute(new UpdateProfileCommand(user.userId, dto));
  }

  @Patch("me/schedule")
  updateSchedule(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateScheduleDto,
  ) {
    return this.commandBus.execute(new UpdateScheduleCommand(user.userId, dto));
  }
}

@Module({
  imports: [CqrsModule],
  controllers: [UsersController],
  providers: [GetMeHandler, UpdateProfileHandler, UpdateScheduleHandler],
})
export class UsersModule {}
