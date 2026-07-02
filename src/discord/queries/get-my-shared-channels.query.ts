import { Injectable } from "@nestjs/common";
import { IQuery, IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { PrismaService } from "../../../prisma/prisma.service";

export interface OwnedSharedChannel {
  id: string;
  channelId: string;
  channelName: string;
  joinCode: string; // owner-only — safe to return here
  enabled: boolean;
  postGoals: boolean;
  postUpdates: boolean;
  memberCount: number;
  lastError: string | null;
}

export interface JoinedSharedChannel {
  id: string;
  channelName: string;
  enabled: boolean; // the member's own enabled flag
}

export interface MySharedChannels {
  owned: OwnedSharedChannel[];
  joined: JoinedSharedChannel[];
}

export class GetMySharedChannelsQuery implements IQuery {
  constructor(public readonly userId: string) {}
}

@Injectable()
@QueryHandler(GetMySharedChannelsQuery)
export class GetMySharedChannelsHandler implements IQueryHandler<
  GetMySharedChannelsQuery,
  MySharedChannels
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: GetMySharedChannelsQuery): Promise<MySharedChannels> {
    const owned = await this.prisma.sharedChannel.findMany({
      where: { ownerUserId: query.userId },
      select: {
        id: true,
        channelId: true,
        channelName: true,
        joinCode: true,
        enabled: true,
        postGoals: true,
        postUpdates: true,
        lastError: true,
        _count: { select: { members: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const memberships = await this.prisma.sharedChannelMember.findMany({
      where: { userId: query.userId },
      select: {
        enabled: true,
        sharedChannel: { select: { id: true, channelName: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return {
      owned: owned.map((s) => ({
        id: s.id,
        channelId: s.channelId,
        channelName: s.channelName,
        joinCode: s.joinCode,
        enabled: s.enabled,
        postGoals: s.postGoals,
        postUpdates: s.postUpdates,
        memberCount: s._count.members,
        lastError: s.lastError,
      })),
      // Never leak joinCode / webhook secrets for channels the caller only joined.
      joined: memberships.map((m) => ({
        id: m.sharedChannel.id,
        channelName: m.sharedChannel.channelName,
        enabled: m.enabled,
      })),
    };
  }
}
