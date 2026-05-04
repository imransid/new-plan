import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { DiscordModule } from '../discord/discord.module';

@Module({
  imports: [DiscordModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
