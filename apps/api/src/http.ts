import type { NestExpressApplication } from "@nestjs/platform-express";

/**
 * What the HTTP server needs in production, apart from the modules. Caddy
 * is the one proxy in front of the API, and it keeps X-Forwarded-For only
 * from proxies it trusts (none), so the header's last address is the
 * phone's. Trusting one hop makes req.ip that address, which the limit on
 * public routes counts by (auth/throttle.ts); without it, every request
 * would seem to come from Caddy and share one limit.
 */
export function configureHttp(app: NestExpressApplication): void {
  app.set("trust proxy", 1);
}
