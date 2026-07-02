import {
  Controller,
  Get,
  Headers,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiExcludeController } from "@nestjs/swagger";

import { SchedulerService } from "./scheduler.service";

/**
 * Secured HTTP trigger for the posting scheduler.
 *
 * This is how scheduled posts get sent on a runtime where the in-process
 * `@Cron` can't be trusted to tick (a sleeping free tier, serverless, etc.):
 * an external scheduler (cron-job.org, a GitHub Action, Upstash QStash, a
 * platform cron, …) calls this endpoint on an interval and it runs the exact
 * same `runDuePosts()` logic. Posting is idempotent, so calling it every minute
 * — or firing twice in the same minute — is safe.
 *
 * Auth: a shared secret in `CRON_SECRET`, supplied via a request header —
 * `Authorization: Bearer <secret>` or `X-Cron-Key: <secret>`. Headers (not a
 * `?key=` query param) so the secret never lands in access logs / CDN / APM.
 * Fails closed when the secret is unset.
 *
 * Hidden from Swagger and NOT behind `JwtAuthGuard` — it has no user context.
 */
@ApiExcludeController()
@Controller("internal/cron")
export class SchedulerController {
  constructor(
    private readonly scheduler: SchedulerService,
    private readonly config: ConfigService,
  ) {}

  @Post("run-due-posts")
  runViaPost(
    @Headers("authorization") auth?: string,
    @Headers("x-cron-key") cronKey?: string,
  ) {
    this.assertAuthorized(auth, cronKey);
    return this.scheduler.runDuePosts();
  }

  // GET variant for cron services that only issue GET requests.
  @Get("run-due-posts")
  runViaGet(
    @Headers("authorization") auth?: string,
    @Headers("x-cron-key") cronKey?: string,
  ) {
    this.assertAuthorized(auth, cronKey);
    return this.scheduler.runDuePosts();
  }

  private assertAuthorized(
    auth: string | undefined,
    cronKey: string | undefined,
  ): void {
    const secret = this.config.get<string>("CRON_SECRET")?.trim();
    if (!secret) {
      // Fail closed: with no secret configured the endpoint is disabled so it
      // can't be abused to trigger posting.
      throw new UnauthorizedException("Cron endpoint is not configured");
    }
    const bearer = auth ? auth.replace(/^Bearer\s+/i, "").trim() : "";
    const provided = bearer || (cronKey ? cronKey.trim() : "");
    if (provided && provided === secret) return;
    throw new UnauthorizedException("Invalid cron credentials");
  }
}
