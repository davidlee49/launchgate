import { readOverrides } from "../signing.js";
import type { Source } from "../types.js";

export const DEFAULT_OVERRIDE_COOKIE = "lg_override";

export interface CookieOverrideOptions {
	/** Secret for the HMAC. Must not be readable by the client. */
	secret: string;
	/** Cookie holding the signed token. Default `lg_override`. */
	cookieName?: string;
}

/**
 * Slot 2 — the signed per-visitor override: how the author sees hidden work on
 * the real production site, with no account and no database.
 *
 * Honours **only** flags declaring `overridable: true`. A visitor must never be
 * able to force a flag with real consequences — harmless while flags are
 * cosmetic, load-bearing the day a project puts an entitlement source in slot 3.
 *
 * A missing, malformed, or tampered token is *undecided*, not an error: hostile
 * input should fall through to the normal chain, not push the flag to its
 * fallback.
 */
export function cookieOverride(options: CookieOverrideOptions): Source {
	const { secret } = options;
	const cookieName = options.cookieName ?? DEFAULT_OVERRIDE_COOKIE;

	return {
		name: "cookieOverride",
		async decide({ key, def }, ctx) {
			if (!def.overridable) return undefined;

			const token = ctx.cookie?.(cookieName);
			if (!token) return undefined;

			const overrides = await readOverrides(token, secret);
			return overrides?.[key];
		},
	};
}
