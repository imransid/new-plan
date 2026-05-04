import { ConfigService } from '@nestjs/config';

/** Matches `.env.example` — local Postgres with user/db `dayplan`. */
const DEV_DEFAULT =
  'postgresql://dayplan:dayplan@localhost:5432/dayplan?schema=public';

export function resolveDatabaseUrl(config: ConfigService): string {
  const fromEnv = config.get<string>('DATABASE_URL')?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL must be set when NODE_ENV is production');
  }
  return DEV_DEFAULT;
}
