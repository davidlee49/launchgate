import type {
	EvaluationContext,
	FlagDef,
	FlagRegistry,
	FlagValueOf,
	Source,
	SourceErrorInfo,
} from "./types.js";

/**
 * Declares a project's flags. Identity at runtime; it exists to infer each flag's
 * value type so `resolve()` is typed at the call site.
 *
 * The registry lives in the project that reads the flags, not in a table and not
 * in library config (Decision 4): flags ship with the code they gate, so deleting
 * one is a pull request and a key nobody reads is visibly dead.
 */
export function defineFlags<T extends FlagRegistry>(flags: T): T {
	return flags;
}

export interface ResolverOptions<T extends FlagRegistry> {
	flags: T;
	/**
	 * Consulted in order; the first definite answer wins. Recommended ordering:
	 * `envOverride` (kill switch), `cookieOverride`, project sources (grants,
	 * opt-in, entitlement), `envDefault`. The flag's `fallback` is terminal and is
	 * not a source, so it cannot be left out.
	 */
	sources: Source[];
	/** Called when a source throws or answers with the wrong type. */
	onError?: (error: unknown, info: SourceErrorInfo) => void;
}

/** Every flag in a registry, evaluated. */
export type ResolvedFlags<T extends FlagRegistry> = {
	[K in keyof T]: FlagValueOf<T, K>;
};

export interface Resolver<T extends FlagRegistry> {
	resolve<K extends keyof T & string>(
		key: K,
		ctx?: EvaluationContext,
	): Promise<FlagValueOf<T, K>>;
	/**
	 * Evaluate the whole registry at once — LaunchDarkly's `allFlagsState()`
	 * pattern: resolve server-side, hand the map to the client, and the UI never
	 * flickers because it never had to ask.
	 *
	 * Resolution is concurrent and shares the context object, so subject-backed
	 * sources hit their per-request cache; with `subjectStore({ loadAll })` the
	 * whole registry costs one read.
	 *
	 * Pass the **values** to a client, never the registry — flag keys name
	 * unshipped work, and a viewer who can't see a surface shouldn't learn its
	 * name from the payload.
	 */
	resolveAll(ctx?: EvaluationContext): Promise<ResolvedFlags<T>>;
	readonly flags: T;
}

export function createResolver<T extends FlagRegistry>(
	options: ResolverOptions<T>,
): Resolver<T> {
	const { flags, sources, onError } = options;

	async function resolve<K extends keyof T & string>(
		key: K,
		ctx: EvaluationContext = {},
	): Promise<FlagValueOf<T, K>> {
		const def: FlagDef | undefined = flags[key];
		// The one thing that throws. An unknown key has no fallback to degrade to,
		// so there is nothing honest to return; it is a programming error, and the
		// registry's types prevent it everywhere except an unchecked cast.
		if (!def) throw new Error(`launchgate: unknown flag "${key}"`);

		const meta = { key, def };

		for (const source of sources) {
			let decision;
			try {
				decision = await source.decide(meta, ctx);
			} catch (error) {
				// Abort to the fallback rather than falling through to the next
				// source (Decision 3): predictability over availability — there is
				// exactly one degraded answer per flag, declared next to the flag.
				onError?.(error, { flag: key, source: source.name });
				return def.fallback as FlagValueOf<T, K>;
			}

			if (decision === undefined) continue;

			if (typeof decision !== typeof def.fallback) {
				onError?.(
					new TypeError(
						`launchgate: source "${source.name}" answered ${typeof decision} for flag "${key}", which is ${typeof def.fallback}`,
					),
					{ flag: key, source: source.name },
				);
				return def.fallback as FlagValueOf<T, K>;
			}

			return decision as FlagValueOf<T, K>;
		}

		return def.fallback as FlagValueOf<T, K>;
	}

	async function resolveAll(
		ctx: EvaluationContext = {},
	): Promise<ResolvedFlags<T>> {
		const keys = Object.keys(flags) as (keyof T & string)[];
		// One shared ctx across all of them — that object is the cache key every
		// subject-backed source uses, so this is what makes the batch a batch.
		const values = await Promise.all(keys.map((key) => resolve(key, ctx)));
		// `Object.fromEntries` widens to an index signature, which no longer
		// overlaps the mapped type — the cast is the assertion that the keys are
		// exactly the registry's, which the line above guarantees.
		return Object.fromEntries(
			keys.map((key, i) => [key, values[i]]),
		) as unknown as ResolvedFlags<T>;
	}

	return { flags, resolve, resolveAll };
}
