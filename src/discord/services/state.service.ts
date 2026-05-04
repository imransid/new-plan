import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

import { resolveJwtSecret } from '../../common/config/jwt-secret';

@Injectable()
export class StateService {
  private readonly secret: string;

  constructor(config: ConfigService) {
    this.secret = resolveJwtSecret(config);
  }

  sign(userId: string): string {
    const payload = `${userId}:${Date.now()}`;
    const sig = createHmac('sha256', this.secret).update(payload).digest('hex');
    return Buffer.from(`${payload}:${sig}`).toString('base64url');
  }

  verify(state: string): string {
    let decoded: string;
    try {
      decoded = Buffer.from(state, 'base64url').toString('utf-8');
    } catch {
      throw new BadRequestException('Invalid state');
    }
    const parts = decoded.split(':');
    if (parts.length !== 3) throw new BadRequestException('Invalid state');
    const [userId, ts, sig] = parts;

    const expected = createHmac('sha256', this.secret)
      .update(`${userId}:${ts}`)
      .digest('hex');

    if (
      sig.length !== expected.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      throw new BadRequestException('State signature mismatch');
    }

    if (Date.now() - Number(ts) > 10 * 60 * 1000) {
      throw new BadRequestException('State expired');
    }

    return userId;
  }
}
