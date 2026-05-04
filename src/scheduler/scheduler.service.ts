import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { DiscordPosterService } from '../discord/services/discord-poster.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly discordPoster: DiscordPosterService,
  ) {}

  /**
   * Runs every minute. For every user, checks whether the current minute (in
   * the user's timezone) matches one of their two configured post times and
   * fires the matching job.
   *
   * - goalPostTime    → "TODAY GOAL" (all today's tasks)
   * - workUpdateTime  → "Work Updated" (only completed tasks)
   *
   * A single user can match both times in the same minute if they coincide;
   * we run them sequentially.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async runDuePosts() {
    const users = await this.prisma.user.findMany({
      include: { reminderSchedule: true },
    });

    if (users.length === 0) return;

    for (const user of users) {
      const localTime = DateTime.now().setZone(user.timezone).toFormat('HH:mm');

      // Goal post — fires at user's configured goalPostTime
      if (localTime === user.goalPostTime) {
        try {
          const result = await this.discordPoster.postGoalList(user.id);
          this.logger.log(
            `[goal] User ${user.email}: posted ${result.posted}, failed ${result.failed}`,
          );
        } catch (err) {
          this.logger.error(`[goal] Failed for user ${user.email}`, err);
        }
      }

      // Work-update post — fires at user's configured workUpdateTime
      if (localTime === user.workUpdateTime) {
        try {
          const result = await this.discordPoster.postWorkUpdate(user.id);
          this.logger.log(
            `[work_update] User ${user.email}: posted ${result.posted}, failed ${result.failed}`,
          );
        } catch (err) {
          this.logger.error(`[work_update] Failed for user ${user.email}`, err);
        }
      }
    }
  }
}
