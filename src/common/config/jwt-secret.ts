import { ConfigService } from '@nestjs/config';

const DEV_FALLBACK =
  'dayplan-local-dev-only-jwt-secret-min-32-chars-do-not-use-in-production';

/**
 * Prefer JWT_SECRET from env; in non-production allow a fixed dev default so the app boots without .env.
 */
export function resolveJwtSecret(config: ConfigService): string {
  const fromEnv = config.get<string>('JWT_SECRET');
  if (fromEnv?.trim()) return fromEnv.trim();
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set when NODE_ENV is production');
  }
  return DEV_FALLBACK;
}
