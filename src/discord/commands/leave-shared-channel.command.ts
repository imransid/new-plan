import { Injectable } from "@nestjs/common";
import { CommandHandler, ICommand, ICommandHandler } from "@nestjs/cqrs";
import { PrismaService } from "../../../prisma/prisma.service";

export class LeaveSharedChannelCommand implements ICommand {
  constructor(
    public readonly userId: string,
    public readonly sharedChannelId: string,
  ) {}
}

@Injectable()
@CommandHandler(LeaveSharedChannelCommand)
export class LeaveSharedChannelHandler implements ICommandHandler<
  LeaveSharedChannelCommand,
  { ok: true }
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: LeaveSharedChannelCommand): Promise<{ ok: true }> {
    // Idempotent: removing a membership that isn't there is a no-op. The next
    // scheduler tick simply stops including this member for that channel.
    await this.prisma.sharedChannelMember.deleteMany({
      where: { sharedChannelId: cmd.sharedChannelId, userId: cmd.userId },
    });
    return { ok: true };
  }
}
