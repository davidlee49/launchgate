import { NextResponse } from 'next/server';
import { b as FlagRegistry, R as Resolver, E as EvaluationContext } from '../resolver-C_2WAfkC.js';

/**
 * Builds an `EvaluationContext` that reads cookies from the incoming request.
 *
 * **This opts the caller into dynamic rendering** — `cookies()` always does. On
 * a page that is already dynamic (anything authenticated) that costs nothing; on
 * a page you need statically rendered, don't call it, and see `staticVariant`
 * in the README instead.
 */
declare function requestContext(extra?: EvaluationContext): Promise<EvaluationContext>;
/**
 * Route-handler guard. 404, not 403: a feature you don't have shouldn't
 * advertise its own existence.
 *
 *   const gate = await requireFlag(resolver, "network", { targetingKey: orgId });
 *   if (gate) return gate;
 */
declare function requireFlag<T extends FlagRegistry, K extends keyof T & string>(resolver: Resolver<T>, key: K, ctx?: EvaluationContext): Promise<NextResponse | null>;
interface OverrideRouteOptions<T extends FlagRegistry> {
    resolver: Resolver<T>;
    /** HMAC secret. Same value `cookieOverride` was given. Never appears in a URL. */
    secret: string;
    /** Shared secret presented as `?token=` to use this route. Must differ from `secret`. */
    accessToken: string;
    cookieName?: string;
    /** Cookie lifetime in seconds. Default 30 days. */
    maxAge?: number;
}
/**
 * `GET /__flags?token=…&flag=newHomepage&value=on` — sets the signed override
 * cookie, so you see hidden work on the real production site with no account and
 * no database. `&clear=1` drops everything; omitting `value` clears one flag.
 *
 * Mount it at a path you don't advertise, and give it a real `accessToken`.
 */
declare function createOverrideRoute<T extends FlagRegistry>(options: OverrideRouteOptions<T>): {
    GET: (request: Request) => Promise<NextResponse>;
};

export { type OverrideRouteOptions, createOverrideRoute, requestContext, requireFlag };
