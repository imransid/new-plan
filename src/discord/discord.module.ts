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
import { CreateSharedChannelHandler } from './commands/create-shared-channel.command';
import { RotateSharedChannelCodeHandler } from './commands/rotate-shared-channel-code.command';
import { UpdateSharedChannelHandler } from './commands/update-shared-channel.command';
import { JoinSharedChannelHandler } from './commands/join-shared-channel.command';
import { LeaveSharedChannelHandler } from './commands/leave-shared-channel.command';
import {
  ListAvailableChannelsHandler,
  GetUserConnectionsHandler,
} from './queries/list-channels.query';
import { GetMySharedChannelsHandler } from './queries/get-my-shared-channels.query';

const Handlers = [
  ConnectDiscordHandler,
  SaveChannelsHandler,
  CreateSharedChannelHandler,
  RotateSharedChannelCodeHandler,
  UpdateSharedChannelHandler,
  JoinSharedChannelHandler,
  LeaveSharedChannelHandler,
  ListAvailableChannelsHandler,
  GetUserConnectionsHandler,
  GetMySharedChannelsHandler,
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
