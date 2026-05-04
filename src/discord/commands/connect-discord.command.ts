import { Injectable } from '@nestjs/common';
import { CommandHandler, ICommand, ICommandHandler } from '@nestjs/cqrs';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { DiscordApiService } from '../services/discord-api.service';
import { CryptoService } from '../services/crypto.service';

export class ConnectDiscordCommand implements ICommand {
  constructor(
    public readonly userId: string,
    public readonly code: string,
  ) {}
}

@Injectable()
@CommandHandler(ConnectDiscordCommand)
export class ConnectDiscordHandler
  implements ICommandHandler<ConnectDiscordCommand, { guildId: string; guildName: string }>
{
  constructor(
    private readonly prisma: PrismaService,
    private readonly discordApi: DiscordApiService,
    private readonly crypto: CryptoService,
  ) {}

  async execute(cmd: ConnectDiscordCommand) {
    const tokens = await this.discordApi.exchangeCode(cmd.code);
    if (!tokens.guild) {
      throw new Error('No guild returned from Discord — bot was not added to a server');
    }

    await this.prisma.discordConnection.upsert({
      where: {
        userId_guildId: { userId: cmd.userId, guildId: tokens.guild.id },
      },
      update: {
        guildName: tokens.guild.name,
        accessToken: this.crypto.encrypt(tokens.access_token),
        refreshToken: tokens.refresh_token ? this.crypto.encrypt(tokens.refresh_token) : null,
        tokenExpiresAt: DateTime.utc()
          .plus({ seconds: tokens.expires_in })
          .toJSDate(),
      },
      create: {
        userId: cmd.userId,
        guildId: tokens.guild.id,
        guildName: tokens.guild.name,
        accessToken: this.crypto.encrypt(tokens.access_token),
        refreshToken: tokens.refresh_token ? this.crypto.encrypt(tokens.refresh_token) : null,
        tokenExpiresAt: DateTime.utc()
          .plus({ seconds: tokens.expires_in })
          .toJSDate(),
      },
    });

    return { guildId: tokens.guild.id, guildName: tokens.guild.name };
  }
}
