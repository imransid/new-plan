import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

import { resolveDiscordEnv } from '../../common/config/discord-env';

const DISCORD_API = 'https://discord.com/api/v10';
/** Incoming webhook type — see Discord WebhookType */
const WEBHOOK_TYPE_INCOMING = 1;
const DAYPLAN_WEBHOOK_NAME = 'DayPlan';
/** OAuth2 authorize page — see https://discord.com/developers/docs/topics/oauth2 */
const DISCORD_OAUTH_AUTHORIZE = 'https://discord.com/oauth2/authorize';

export interface DiscordTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  guild?: { id: string; name: string };
}

export interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  parent_id: string | null;
}

@Injectable()
export class DiscordApiService {
  private readonly logger = new Logger(DiscordApiService.name);
  private readonly bot: AxiosInstance;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  /** 0 = GUILD_INSTALL, 1 = USER_INSTALL — must match Developer Portal → Installation */
  private readonly oauthIntegrationType: string;

  constructor(config: ConfigService) {
    const { botToken, clientId, clientSecret, redirectUri } = resolveDiscordEnv(config);
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.oauthIntegrationType =
      config.get<string>('DISCORD_OAUTH_INTEGRATION_TYPE')?.trim() || '0';

    if (!botToken && process.env.NODE_ENV !== 'production') {
      this.logger.warn('DISCORD_BOT_TOKEN is unset — Discord API calls will fail until .env is configured');
    }

    this.bot = axios.create({
      baseURL: DISCORD_API,
      headers: { Authorization: `Bot ${botToken}` },
    });
  }

  buildAuthUrl(state: string): string {
    if (!this.clientId) {
      throw new BadRequestException(
        'Discord OAuth is not configured: set DISCORD_CLIENT_ID (and related vars) in backend/.env — see .env.example.',
      );
    }
    if (!this.redirectUri) {
      throw new BadRequestException(
        'DISCORD_REDIRECT_URI is missing. It must exactly match a URL under OAuth2 → Redirects in the Discord Developer Portal (e.g. http://localhost:3000/auth/discord/callback).',
      );
    }

    // `bot` implies `applications.commands`; Discord then requires an installation context
    // or the authorize page returns a generic "Invalid Form Body" error.
    const params = new URLSearchParams({
      client_id: this.clientId,
      // Send Messages + Manage Webhooks (create/list channel webhooks for “post as user name”)
      permissions: String(2048 | (1 << 29)),
      scope: 'bot applications.commands identify guilds',
      response_type: 'code',
      redirect_uri: this.redirectUri,
      state,
      integration_type: this.oauthIntegrationType,
      prompt: 'consent',
    });
    return `${DISCORD_OAUTH_AUTHORIZE}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<DiscordTokens> {
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
    });
    const { data } = await axios.post<DiscordTokens>(
      `${DISCORD_API}/oauth2/token`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    return data;
  }

  async listTextChannels(guildId: string): Promise<DiscordChannel[]> {
    const { data } = await this.bot.get<DiscordChannel[]>(`/guilds/${guildId}/channels`);
    return data.filter((c) => c.type === 0);
  }

  async postMessage(
    channelId: string,
    payload: { content?: string; embeds?: any[] },
  ): Promise<{ id: string }> {
    const { data } = await this.bot.post(`/channels/${channelId}/messages`, payload);
    return { id: data.id };
  }

  /**
   * Finds or creates an incoming webhook owned by this application so we can execute it with a
   * custom username (Discord does not allow overriding the bot name on normal bot messages).
   */
  async ensurePostingWebhook(channelId: string): Promise<{ id: string; token: string }> {
    const { data } = await this.bot.get<
      Array<{
        id: string;
        token?: string;
        type: number;
        name: string | null;
        application_id: string | null;
      }>
    >(`/channels/${channelId}/webhooks`);

    const ours = data.find(
      (w) =>
        w.type === WEBHOOK_TYPE_INCOMING &&
        w.application_id === this.clientId &&
        w.token &&
        (w.name === DAYPLAN_WEBHOOK_NAME || w.name?.startsWith('DayPlan')),
    );
    if (ours?.token) {
      return { id: ours.id, token: ours.token };
    }

    const { data: created } = await this.bot.post<{ id: string; token: string }>(
      `/channels/${channelId}/webhooks`,
      { name: DAYPLAN_WEBHOOK_NAME },
    );
    return { id: created.id, token: created.token };
  }

  /** POST as webhook — appears in chat with optional username / avatar_url. */
  async executeWebhook(
    webhookId: string,
    webhookToken: string,
    body: {
      content?: string;
      embeds?: any[];
      username?: string;
      avatar_url?: string;
    },
  ): Promise<{ id: string }> {
    const { data } = await axios.post<{ id: string }>(
      `${DISCORD_API}/webhooks/${webhookId}/${webhookToken}`,
      body,
      { params: { wait: 'true' } },
    );
    return { id: data.id };
  }
}
