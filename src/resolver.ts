import type {
	Context,
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

export interface Resolver<T extends FlagRegistry> {
	resolve<K extends keyof T & string>(
		key: K,
		ctx?: Context,
	): Promise<FlagValueOf<T, K>>;
	readonly flags: T;
}

export function createResolver<T extends FlagRegistry>(
	options: ResolverOptions<T>,
): Resolver<T> {
	const { flags, sources, onError } = options;

	async function resolve<K extends keyof T & string>(
		key: K,
		ctx: Context = {},
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

	return { flags, resolve };
}
