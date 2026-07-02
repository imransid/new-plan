import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { CommandHandler, ICommand, ICommandHandler } from "@nestjs/cqrs";
import { PrismaService } from "../../../prisma/prisma.service";

export interface UpdateSharedChannelPatch {
  enabled?: boolean;
  postGoals?: boolean;
  postUpdates?: boolean;
}

export class UpdateSharedChannelCommand implements ICommand {
  constructor(
    public readonly userId: string,
    public readonly sharedChannelId: string,
    public readonly patch: UpdateSharedChannelPatch,
  ) {}
}

@Injectable()
@CommandHandler(UpdateSharedChannelCommand)
export class UpdateSharedChannelHandler implements ICommandHandler<UpdateSharedChannelCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: UpdateSharedChannelCommand) {
    const sc = await this.prisma.sharedChannel.findUnique({
      where: { id: cmd.sharedChannelId },
    });
    if (!sc) throw new NotFoundException("Team channel not found");
    if (sc.ownerUserId !== cmd.userId) {
      throw new ForbiddenException("Only the owner can change this team channel");
    }

    const updated = await this.prisma.sharedChannel.update({
      where: { id: sc.id },
      data: {
        enabled: cmd.patch.enabled,
        postGoals: cmd.patch.postGoals,
        postUpdates: cmd.patch.postUpdates,
      },
      select: {
        id: true,
        channelName: true,
        joinCode: true,
        enabled: true,
        postGoals: true,
        postUpdates: true,
      },
    });
    return updated;
  }
}
