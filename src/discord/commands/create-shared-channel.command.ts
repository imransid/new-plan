import { Injectable, NotFoundException } from "@nestjs/common";
import { CommandHandler, ICommand, ICommandHandler } from "@nestjs/cqrs";
import { PrismaService } from "../../../prisma/prisma.service";
import { generateJoinCode } from "../services/join-code.util";

export interface SharedChannelSummary {
  id: string;
  channelName: string;
  joinCode: string;
  enabled: boolean;
  postGoals: boolean;
  postUpdates: boolean;
}

export class CreateSharedChannelCommand implements ICommand {
  constructor(
    public readonly userId: string,
    public readonly guildId: string,
    public readonly channelId: string,
  ) {}
}

@Injectable()
@CommandHandler(CreateSharedChannelCommand)
export class CreateSharedChannelHandler implements ICommandHandler<
  CreateSharedChannelCommand,
  SharedChannelSummary
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: CreateSharedChannelCommand): Promise<SharedChannelSummary> {
    // The connection must belong to the caller (owner-only sharing).
    const conn = await this.prisma.discordConnection.findUnique({
      where: { userId_guildId: { userId: cmd.userId, guildId: cmd.guildId } },
    });
    if (!conn) {
      throw new NotFoundException("Discord connection not found");
    }

    // The channel must already be a configured DiscordChannel under this
    // connection (gives us a real name and confirms the bot has it).
    const channel = await this.prisma.discordChannel.findFirst({
      where: { connectionId: conn.id, channelId: cmd.channelId },
    });
    if (!channel) {
      throw new NotFoundException(
        "Channel not found in this connection — select it under your channels first",
      );
    }

    // Re-flagging the same channel is idempotent: return the existing feed.
    const existing = await this.prisma.sharedChannel.findUnique({
      where: {
        connectionId_channelId: {
          connectionId: conn.id,
          channelId: cmd.channelId,
        },
      },
    });
    if (existing) {
      return this.toSummary(existing);
    }

    const created = await this.createWithUniqueCode(
      cmd.userId,
      conn.id,
      cmd.channelId,
      channel.channelName,
    );
    return this.toSummary(created);
  }

  private async createWithUniqueCode(
    ownerUserId: string,
    connectionId: string,
    channelId: string,
    channelName: string,
  ) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.sharedChannel.create({
          data: {
            ownerUserId,
            connectionId,
            channelId,
            channelName,
            joinCode: generateJoinCode(),
          },
        });
      } catch (err: any) {
        if (err?.code === "P2002") {
          // Either a join-code collision (retry) or a concurrent create of the
          // same (connection, channel) — in the latter case return the winner.
          const raced = await this.prisma.sharedChannel.findUnique({
            where: { connectionId_channelId: { connectionId, channelId } },
          });
          if (raced) return raced;
          continue;
        }
        throw err;
      }
    }
    throw new Error("Could not generate a unique join code");
  }

  private toSummary(s: {
    id: string;
    channelName: string;
    joinCode: string;
    enabled: boolean;
    postGoals: boolean;
    postUpdates: boolean;
  }): SharedChannelSummary {
    return {
      id: s.id,
      channelName: s.channelName,
      joinCode: s.joinCode,
      enabled: s.enabled,
      postGoals: s.postGoals,
      postUpdates: s.postUpdates,
    };
  }
}
