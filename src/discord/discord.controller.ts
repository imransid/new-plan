import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import { IsIn, IsString } from "class-validator";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/decorators/current-user.decorator";
import { DiscordApiService } from "./services/discord-api.service";
import { DiscordPosterService } from "./services/discord-poster.service";
import { StateService } from "./services/state.service";
import {
  SaveChannelsDto,
  CreateSharedChannelDto,
  JoinSharedChannelDto,
  UpdateSharedChannelDto,
} from "./dto/discord.dto";
import { ConnectDiscordCommand } from "./commands/connect-discord.command";
import { SaveChannelsCommand } from "./commands/save-channels.command";
import { CreateSharedChannelCommand } from "./commands/create-shared-channel.command";
import { RotateSharedChannelCodeCommand } from "./commands/rotate-shared-channel-code.command";
import { UpdateSharedChannelCommand } from "./commands/update-shared-channel.command";
import { JoinSharedChannelCommand } from "./commands/join-shared-channel.command";
import { LeaveSharedChannelCommand } from "./commands/leave-shared-channel.command";
import {
  ListAvailableChannelsQuery,
  GetUserConnectionsQuery,
} from "./queries/list-channels.query";
import { GetMySharedChannelsQuery } from "./queries/get-my-shared-channels.query";

class TestPublishDto {
  @IsString()
  @IsIn(["goal", "work_update"])
  kind!: "goal" | "work_update";
}

@ApiTags("Discord")
@Controller()
export class DiscordController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly discordApi: DiscordApiService,
    private readonly discordPoster: DiscordPosterService,
    private readonly stateService: StateService,
    private readonly config: ConfigService,
  ) {}

  // ─── Step 1: app calls this to get the OAuth URL ──────────────────
  @Get("discord/auth-url")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get the Discord OAuth URL with a signed state" })
  getAuthUrl(@CurrentUser() user: AuthUser): { url: string } {
    const state = this.stateService.sign(user.userId);
    return { url: this.discordApi.buildAuthUrl(state) };
  }

  // ─── Step 2: Discord redirects here (no JWT — comes from browser) ─
  @Get("auth/discord/callback")
  @ApiOperation({
    summary: "OAuth callback — saves connection, deep-links to app",
  })
  async callback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Res() res: Response,
  ): Promise<void> {
    const userId = this.stateService.verify(state);

    try {
      const result = await this.commandBus.execute(
        new ConnectDiscordCommand(userId, code),
      );
      const deepLinkPrefix =
        this.config.get<string>("MOBILE_DEEP_LINK_PREFIX") ?? "dayplan://";
      res.redirect(
        HttpStatus.FOUND,
        `${deepLinkPrefix}discord-connected?guild=${result.guildId}`,
      );
    } catch (err) {
      const deepLinkPrefix =
        this.config.get<string>("MOBILE_DEEP_LINK_PREFIX") ?? "dayplan://";
      res.redirect(
        HttpStatus.FOUND,
        `${deepLinkPrefix}discord-error?reason=${encodeURIComponent(
          err instanceof Error ? err.message : "unknown",
        )}`,
      );
    }
  }

  // ─── Step 3: app fetches available channels ───────────────────────
  @Get("discord/channels")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "List text channels in connected Discord server" })
  listChannels(
    @CurrentUser() user: AuthUser,
    @Query("guildId") guildId: string,
  ) {
    return this.queryBus.execute(
      new ListAvailableChannelsQuery(user.userId, guildId),
    );
  }

  // ─── Step 4: app saves user's selection ───────────────────────────
  @Post("discord/channels")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Save selected channels" })
  async saveChannels(
    @CurrentUser() user: AuthUser,
    @Body() dto: SaveChannelsDto,
  ): Promise<{ ok: true }> {
    await this.commandBus.execute(
      new SaveChannelsCommand(user.userId, dto.guildId, dto.channels),
    );
    return { ok: true };
  }

  @Get("discord/connections")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get all Discord connections for the user" })
  getConnections(@CurrentUser() user: AuthUser) {
    return this.queryBus.execute(new GetUserConnectionsQuery(user.userId));
  }

  /**
   * On-demand publish so the mobile app (or curl) can sanity-check Discord
   * delivery without waiting for the next scheduler tick. Returns the same
   * `PostResult` shape the scheduler logs, so failures are visible in the
   * response body — no need to dig through server logs.
   */
  @Post("discord/test-publish")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Publish a goal or work-update post immediately" })
  async testPublish(
    @CurrentUser() user: AuthUser,
    @Body() dto: TestPublishDto,
  ) {
    if (dto.kind === "goal") {
      return this.discordPoster.postGoalList(user.userId);
    }
    if (dto.kind === "work_update") {
      return this.discordPoster.postWorkUpdate(user.userId);
    }
    throw new BadRequestException("Unknown kind");
  }

  // ─── Team / shared channels ───────────────────────────────────────
  // Owner: flag one of your connected channels as a shared "team feed" and get
  // a join code teammates enter in-app. Members: join/leave by code. Each
  // member's scheduled goal/work-update then auto-posts into the feed under
  // their name (via the owner's bot webhook).

  @Get("discord/shared-channels")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "List team channels I own and ones I've joined" })
  getSharedChannels(@CurrentUser() user: AuthUser) {
    return this.queryBus.execute(new GetMySharedChannelsQuery(user.userId));
  }

  @Post("discord/shared-channels")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Make one of my channels a shared team channel" })
  createSharedChannel(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSharedChannelDto,
  ) {
    return this.commandBus.execute(
      new CreateSharedChannelCommand(user.userId, dto.guildId, dto.channelId),
    );
  }

  @Patch("discord/shared-channels/:id")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Toggle a team channel (owner only)" })
  updateSharedChannel(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: UpdateSharedChannelDto,
  ) {
    return this.commandBus.execute(
      new UpdateSharedChannelCommand(user.userId, id, dto),
    );
  }

  @Post("discord/shared-channels/:id/rotate-code")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Rotate the join code (owner only)" })
  rotateSharedChannelCode(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    return this.commandBus.execute(
      new RotateSharedChannelCodeCommand(user.userId, id),
    );
  }

  @Post("discord/shared-channels/join")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Join a team channel with a code" })
  joinSharedChannel(
    @CurrentUser() user: AuthUser,
    @Body() dto: JoinSharedChannelDto,
  ) {
    return this.commandBus.execute(
      new JoinSharedChannelCommand(user.userId, dto.joinCode),
    );
  }

  @Delete("discord/shared-channels/:id/leave")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Leave a team channel" })
  leaveSharedChannel(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.commandBus.execute(
      new LeaveSharedChannelCommand(user.userId, id),
    );
  }
}
