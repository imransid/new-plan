import { Injectable, UnauthorizedException } from '@nestjs/common';
import { CommandHandler, ICommand, ICommandHandler } from '@nestjs/cqrs';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthResponseDto } from '../dto/auth.dto';

export class SignInCommand implements ICommand {
  constructor(
    public readonly email: string,
    public readonly password: string,
  ) {}
}

@Injectable()
@CommandHandler(SignInCommand)
export class SignInHandler implements ICommandHandler<SignInCommand, AuthResponseDto> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async execute(cmd: SignInCommand): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { email: cmd.email } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(cmd.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

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
