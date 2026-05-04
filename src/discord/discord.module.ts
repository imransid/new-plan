import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { DiscordController } from './discord.controller';
import { DiscordApiService } from './services/discord-api.service';
import { DiscordPosterService } from './services/discord-poster.service';
import { MessageFormatterService } from './services/message-formatter.service';
import { StateService } from './services/state.service';
import { CryptoService } from './services/crypto.service';

import { ConnectDiscordHandler } from './commands/connect-discord.command';
import { SaveChannelsHandler } from './commands/save-channels.command';
import {
  ListAvailableChannelsHandler,
  GetUserConnectionsHandler,
} from './queries/list-channels.query';

const Handlers = [
  ConnectDiscordHandler,
  SaveChannelsHandler,
  ListAvailableChannelsHandler,
  GetUserConnectionsHandler,
];

@Module({
  imports: [CqrsModule],
  controllers: [DiscordController],
  providers: [
    DiscordApiService,
    DiscordPosterService,
    MessageFormatterService,
    StateService,
    CryptoService,
    ...Handlers,
  ],
  exports: [DiscordPosterService],
})
export class DiscordModule {}
