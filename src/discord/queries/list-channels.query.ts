import { Injectable, NotFoundException } from "@nestjs/common";
import { IQuery, IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { PrismaService } from "../../prisma/prisma.service";
import { DiscordApiService } from "../services/discord-api.service";

export class ListAvailableChannelsQuery implements IQuery {
  constructor(
    public readonly userId: string,
    public readonly guildId: string,
  ) {}
}

@Injectable()
@QueryHandler(ListAvailableChannelsQuery)
export class ListAvailableChannelsHandler implements IQueryHandler<
  ListAvailableChannelsQuery,
  Array<{ id: string; name: string; parentId: string | null }>
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discordApi: DiscordApiService,
  ) {}

  async execute(query: ListAvailableChannelsQuery) {
    const conn = await this.prisma.discordConnection.findUnique({
      where: {
        userId_guildId: { userId: query.userId, guildId: query.guildId },
      },
    });
    if (!conn) {
      throw new NotFoundException("Discord connection not found");
    }

    const channels = await this.discordApi.listTextChannels(query.guildId);
    return channels.map((c) => ({
      id: c.id,
      name: c.name,
      parentId: c.parent_id,
    }));
  }
}

export class GetUserConnectionsQuery implements IQuery {
  constructor(public readonly userId: string) {}
}

@Injectable()
@QueryHandler(GetUserConnectionsQuery)
export class GetUserConnectionsHandler implements IQueryHandler<GetUserConnectionsQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: GetUserConnectionsQuery) {
    return this.prisma.discordConnection.findMany({
      where: { userId: query.userId },
      include: {
        channels: {
          select: {
            id: true,
            channelId: true,
            channelName: true,
            enabled: true,
            format: true,
            postGoals: true,
            postUpdates: true,
          },
        },
      },
    });
  }
}
