import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

import { resolveDatabaseUrl } from '../common/config/database-url';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    const url = resolveDatabaseUrl(config);
    super({
      datasources: { db: { url } },
    });
    if (!config.get<string>('DATABASE_URL')?.trim() && process.env.NODE_ENV !== 'production') {
      this.logger.warn(`DATABASE_URL unset — using local dev default (${new URL(url).host})`);
    }
  }

  async onModuleInit() {
    try {
      await this.$connect();
    } catch (e) {
      if (process.env.NODE_ENV === 'production') throw e;
      const code = (e as { errorCode?: string })?.errorCode;
      if (code === 'P1010' || code === 'P1000' || code === 'P1001') {
        const hint =
          'Start Postgres with the project DB (from repo root): `docker compose up -d db` — ' +
          'or set `DATABASE_URL` in `backend/.env` to a user/database you already have.';
        this.logger.error(`${(e as Error).message} (${code}). ${hint}`);
      }
      throw e;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
