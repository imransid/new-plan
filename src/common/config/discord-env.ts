import { ConfigService } from '@nestjs/config';

export type DiscordEnv = {
  botToken: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

/**
 * Discord OAuth + bot API credentials. In production all values are required; in dev, empty
 * strings allow the app to boot (Discord routes fail until .env is filled).
 */
export function resolveDiscordEnv(config: ConfigService): DiscordEnv {
  const botToken = config.get<string>('DISCORD_BOT_TOKEN')?.trim() ?? '';
  const clientId = config.get<string>('DISCORD_CLIENT_ID')?.trim() ?? '';
  const clientSecret = config.get<string>('DISCORD_CLIENT_SECRET')?.trim() ?? '';
  const redirectUri = config.get<string>('DISCORD_REDIRECT_URI')?.trim() ?? '';

  if (process.env.NODE_ENV === 'production') {
    const missing: string[] = [];
    if (!botToken) missing.push('DISCORD_BOT_TOKEN');
    if (!clientId) missing.push('DISCORD_CLIENT_ID');
    if (!clientSecret) missing.push('DISCORD_CLIENT_SECRET');
    if (!redirectUri) missing.push('DISCORD_REDIRECT_URI');
    if (missing.length) {
      throw new Error(`Missing required env in production: ${missing.join(', ')}`);
    }
  }

  return { botToken, clientId, clientSecret, redirectUri };
}
