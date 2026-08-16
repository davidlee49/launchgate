import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { Resolver } from "../resolver.js";
import { readOverrides, signOverrides } from "../signing.js";
import { DEFAULT_OVERRIDE_COOKIE } from "../sources/cookie.js";
import type { EvaluationContext, FlagRegistry, FlagValue } from "../types.js";

/**
 * Builds an `EvaluationContext` that reads cookies from the incoming request.
 *
 * **This opts the caller into dynamic rendering** — `cookies()` always does. On
 * a page that is already dynamic (anything authenticated) that costs nothing; on
 * a page you need statically rendered, don't call it, and see `staticVariant`
 * in the README instead.
 */
export async function requestContext(extra: EvaluationContext = {}): Promise<EvaluationContext> {
	const jar = await cookies();
	return { ...extra, cookie: (name) => jar.get(name)?.value };
}

/**
 * Route-handler guard. 404, not 403: a feature you don't have shouldn't
 * advertise its own existence.
 *
 *   const gate = await requireFlag(resolver, "network", { targetingKey: orgId });
 *   if (gate) return gate;
 */
export async function requireFlag<T extends FlagRegistry, K extends keyof T & string>(
	resolver: Resolver<T>,
	key: K,
	ctx?: EvaluationContext,
): Promise<NextResponse | null> {
	const value = await resolver.resolve(key, ctx);
	return value === false || value === undefined
		? NextResponse.json({ error: "Not found" }, { status: 404 })
		: null;
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

function parseAs(raw: string, fallback: FlagValue): FlagValue | undefined {
	if (typeof fallback === "boolean") {
		const v = raw.trim().toLowerCase();
		if (v === "on" || v === "true" || v === "1") return true;
		if (v === "off" || v === "false" || v === "0") return false;
		return undefined;
	}
	if (typeof fallback === "number") {
		const n = Number(raw);
		return Number.isFinite(n) ? n : undefined;
	}
	return raw;
}

export interface OverrideRouteOptions<T extends FlagRegistry> {
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
export function createOverrideRoute<T extends FlagRegistry>(
	options: OverrideRouteOptions<T>,
): { GET: (request: Request) => Promise<NextResponse> } {
	const { resolver, secret, accessToken } = options;
	const cookieName = options.cookieName ?? DEFAULT_OVERRIDE_COOKIE;
	const maxAge = options.maxAge ?? 60 * 60 * 24 * 30;

	async function GET(request: Request): Promise<NextResponse> {
		const url = new URL(request.url);
		const token = url.searchParams.get("token") ?? "";

		// 404 rather than 401: an unadvertised route should stay unadvertised.
		if (!timingSafeEqual(token, accessToken)) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		const jar = await cookies();
		const current = jar.get(cookieName)?.value;
		let overrides: Record<string, FlagValue> =
			(current ? await readOverrides(current, secret) : undefined) ?? {};

		if (url.searchParams.get("clear") !== null) {
			overrides = {};
		} else {
			const key = url.searchParams.get("flag");
			if (!key) {
				return NextResponse.json({ error: "flag is required" }, { status: 400 });
			}

			const def = resolver.flags[key];
			if (!def) {
				return NextResponse.json({ error: `unknown flag "${key}"` }, { status: 400 });
			}
			if (!def.overridable) {
				return NextResponse.json(
					{ error: `flag "${key}" is not overridable` },
					{ status: 400 },
				);
			}

			const raw = url.searchParams.get("value");
			if (raw === null) {
				delete overrides[key];
			} else {
				const value = parseAs(raw, def.fallback);
				if (value === undefined) {
					return NextResponse.json(
						{ error: `"${raw}" is not a valid value for "${key}"` },
						{ status: 400 },
					);
				}
				overrides[key] = value;
			}
		}

		const body = { overrides };
		const response = NextResponse.json(body);

		if (Object.keys(overrides).length === 0) {
			response.cookies.delete(cookieName);
		} else {
			response.cookies.set(cookieName, await signOverrides(overrides, secret), {
				httpOnly: true,
				sameSite: "lax",
				secure: url.protocol === "https:",
				path: "/",
				maxAge,
			});
		}

		return response;
	}

	return { GET };
}
