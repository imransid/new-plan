import { Injectable, NotFoundException } from "@nestjs/common";
import { CommandHandler, ICommand, ICommandHandler } from "@nestjs/cqrs";
import { ChannelFormat } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface ChannelSelection {
  channelId: string;
  channelName: string;
  enabled?: boolean;
  format?: ChannelFormat;
  postGoals?: boolean;
  postUpdates?: boolean;
}

export class SaveChannelsCommand implements ICommand {
  constructor(
    public readonly userId: string,
    public readonly guildId: string,
    public readonly channels: ChannelSelection[],
  ) {}
}

@Injectable()
@CommandHandler(SaveChannelsCommand)
export class SaveChannelsHandler implements ICommandHandler<
  SaveChannelsCommand,
  void
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: SaveChannelsCommand): Promise<void> {
    const connection = await this.prisma.discordConnection.findUnique({
      where: { userId_guildId: { userId: cmd.userId, guildId: cmd.guildId } },
    });
    if (!connection) {
      throw new NotFoundException("Discord connection not found");
    }

    await this.prisma.$transaction([
      this.prisma.discordChannel.deleteMany({
        where: { connectionId: connection.id },
      }),
      this.prisma.discordChannel.createMany({
        data: cmd.channels.map((c) => ({
          connectionId: connection.id,
          channelId: c.channelId,
          channelName: c.channelName,
          enabled: c.enabled ?? true,
          format: c.format ?? ChannelFormat.EMBED,
          postGoals: c.postGoals ?? true,
          postUpdates: c.postUpdates ?? true,
        })),
      }),
    ]);
  }
}
