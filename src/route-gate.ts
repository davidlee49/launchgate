import type { Resolver } from "./resolver.js";
import type { Context, FlagRegistry } from "./types.js";

/**
 * Prefix match: exact, or a path segment below it.
 *
 * `"/"` matches only `"/"` — it falls out of the general rule rather than needing
 * a special case, because no real pathname starts with `"//"`.
 *
 * Exported standalone because nav filtering usually runs in a client component,
 * where the rule must be identical to the server's or the menu and the router
 * disagree.
 */
export function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
	return prefixes.some(
		(prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
	);
}

export interface RouteGateOptions<T extends FlagRegistry> {
	resolver: Resolver<T>;
	/** Flag key → the path prefixes it reveals. A flag may reveal several. */
	routes: Partial<Record<keyof T & string, readonly string[]>>;
	/**
	 * Paths served regardless of any flag — the launched surface. Omit for an
	 * app whose routes are all either public or flagged.
	 */
	allow?: readonly string[];
	/**
	 * What to do with a path that is neither allowed nor covered by a flag.
	 *
	 * Required, with no default, because it is the whole safety posture and the
	 * two answers fail in very different ways. `"deny"` means a route added
	 * tomorrow is hidden until someone lists it — it 404s loudly and safely.
	 * `"allow"` means it ships publicly the moment it exists, and forgetting to
	 * flag work in progress leaks it silently.
	 */
	unlisted: "deny" | "allow";
}

export interface RouteGate {
	/** May this path be served right now? */
	isPermitted(pathname: string, ctx?: Context): Promise<boolean>;
	/** Prefixes currently revealed by a flag. For filtering nav server-side. */
	revealedPrefixes(ctx?: Context): Promise<string[]>;
	/** Everything servable right now — `allow` plus whatever is revealed. */
	permittedPrefixes(ctx?: Context): Promise<string[]>;
}

/**
 * Turns "which flags are on" into "which paths may be served".
 *
 * The app supplies two lists — what is launched, and which flag hides what. This
 * owns the policy: check the allowlist first (so a launched route costs no flag
 * resolution at all), then ask the flags.
 *
 * **Throws at construction** if a prefix is both allowed and flagged. That flag
 * could never change anything, because the allowlist would already be letting
 * the path through — a silent no-op that is very hard to spot by reading, and
 * exactly the kind of thing a launch gate must not have.
 */
export function createRouteGate<T extends FlagRegistry>(
	options: RouteGateOptions<T>,
): RouteGate {
	const { resolver, routes, allow = [], unlisted } = options;

	const entries = Object.entries(routes) as [keyof T & string, readonly string[]][];

	for (const [key, prefixes] of entries) {
		for (const prefix of prefixes) {
			if (allow.includes(prefix)) {
				throw new Error(
					`launchgate: "${prefix}" is both allowed and gated by flag "${key}". ` +
						`The allowlist would serve it whatever the flag says, so the flag is dead.`,
				);
			}
		}
		if (!(key in resolver.flags)) {
			throw new Error(`launchgate: routes reference unknown flag "${key}"`);
		}
	}

	async function revealedPrefixes(ctx: Context = {}): Promise<string[]> {
		const revealed = await Promise.all(
			entries.map(async ([key, prefixes]) =>
				(await resolver.resolve(key, ctx)) ? prefixes : [],
			),
		);
		return revealed.flat();
	}

	return {
		revealedPrefixes,

		async permittedPrefixes(ctx) {
			return [...allow, ...(await revealedPrefixes(ctx))];
		},

		async isPermitted(pathname, ctx) {
			// Allowlist first: a launched route short-circuits and resolves nothing.
			if (matchesPrefix(pathname, allow)) return true;
			if (matchesPrefix(pathname, await revealedPrefixes(ctx))) return true;
			// Covered by a flag that is currently off → denied regardless of policy;
			// `unlisted` only decides paths nothing has an opinion about.
			const flagged = entries.flatMap(([, prefixes]) => prefixes);
			if (matchesPrefix(pathname, flagged)) return false;
			return unlisted === "allow";
		},
	};
}
