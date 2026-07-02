import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { CommandHandler, ICommand, ICommandHandler } from "@nestjs/cqrs";
import { PrismaService } from "../../../prisma/prisma.service";
import { generateJoinCode } from "../services/join-code.util";

export class RotateSharedChannelCodeCommand implements ICommand {
  constructor(
    public readonly userId: string,
    public readonly sharedChannelId: string,
  ) {}
}

@Injectable()
@CommandHandler(RotateSharedChannelCodeCommand)
export class RotateSharedChannelCodeHandler implements ICommandHandler<
  RotateSharedChannelCodeCommand,
  { id: string; joinCode: string }
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: RotateSharedChannelCodeCommand) {
    const sc = await this.prisma.sharedChannel.findUnique({
      where: { id: cmd.sharedChannelId },
    });
    if (!sc) throw new NotFoundException("Team channel not found");
    if (sc.ownerUserId !== cmd.userId) {
      throw new ForbiddenException("Only the owner can rotate the code");
    }

    // Rotating instantly invalidates the old code; memberships are untouched.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const updated = await this.prisma.sharedChannel.update({
          where: { id: sc.id },
          data: { joinCode: generateJoinCode() },
        });
        return { id: updated.id, joinCode: updated.joinCode };
      } catch (err: any) {
        if (err?.code === "P2002") continue; // join-code collision — retry
        throw err;
      }
    }
    throw new Error("Could not generate a unique join code");
  }
}
