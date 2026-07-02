import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { CommandHandler, ICommand, ICommandHandler } from "@nestjs/cqrs";
import { PrismaService } from "../../../prisma/prisma.service";
import { normalizeJoinCode } from "../services/join-code.util";

const MAX_ATTEMPTS_PER_MINUTE = 10;

export class JoinSharedChannelCommand implements ICommand {
  constructor(
    public readonly userId: string,
    public readonly joinCode: string,
  ) {}
}

@Injectable()
@CommandHandler(JoinSharedChannelCommand)
export class JoinSharedChannelHandler implements ICommandHandler<
  JoinSharedChannelCommand,
  { sharedChannelId: string; channelName: string }
> {
  constructor(private readonly prisma: PrismaService) {}

  // Lightweight per-user throttle on code redemption. The codes are ~71-bit so
  // brute force is infeasible; this just caps abuse. (Singleton handler → state
  // persists for the process; fine at this scale, no Redis needed.)
  private readonly attempts = new Map<string, number[]>();

  private throttle(userId: string): void {
    const now = Date.now();
    const windowStart = now - 60_000;
    const recent = (this.attempts.get(userId) ?? []).filter((t) => t > windowStart);
    if (recent.length >= MAX_ATTEMPTS_PER_MINUTE) {
      throw new BadRequestException("Too many attempts — try again in a minute");
    }
    recent.push(now);
    this.attempts.set(userId, recent);
  }

  async execute(cmd: JoinSharedChannelCommand) {
    this.throttle(cmd.userId);

    const code = normalizeJoinCode(cmd.joinCode);
    const sc = await this.prisma.sharedChannel.findUnique({
      where: { joinCode: code },
    });
    if (!sc || !sc.enabled) {
      throw new NotFoundException("Invalid or expired team-channel code");
    }
    if (sc.ownerUserId === cmd.userId) {
      throw new BadRequestException("You own this channel — you already post here");
    }

    const memberCount = await this.prisma.sharedChannelMember.count({
      where: { sharedChannelId: sc.id },
    });
    if (memberCount >= sc.maxMembers) {
      throw new ConflictException("This team channel is full");
    }

    try {
      await this.prisma.sharedChannelMember.create({
        data: { sharedChannelId: sc.id, userId: cmd.userId },
      });
    } catch (err: any) {
      // Already a member — treat as an idempotent success.
      if (err?.code !== "P2002") throw err;
    }

    return { sharedChannelId: sc.id, channelName: sc.channelName };
  }
}
