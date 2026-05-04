import { ConflictException, Injectable } from '@nestjs/common';
import { CommandHandler, ICommand, ICommandHandler } from '@nestjs/cqrs';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthResponseDto } from '../dto/auth.dto';

export class SignUpCommand implements ICommand {
  constructor(
    public readonly email: string,
    public readonly password: string,
    public readonly name?: string,
    public readonly timezone?: string,
  ) {}
}

@Injectable()
@CommandHandler(SignUpCommand)
export class SignUpHandler implements ICommandHandler<SignUpCommand, AuthResponseDto> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async execute(cmd: SignUpCommand): Promise<AuthResponseDto> {
    const existing = await this.prisma.user.findUnique({ where: { email: cmd.email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(cmd.password, 12);

    const user = await this.prisma.user.create({
      data: {
        email: cmd.email,
        passwordHash,
        name: cmd.name,
        timezone: cmd.timezone ?? 'UTC',
        reminderSchedule: { create: {} },
      },
      include: { reminderSchedule: true },
    });

    const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        timezone: user.timezone,
      },
    };
  }
}
