import { createResolver, type Resolver } from "./resolver.js";
import type { FlagRegistry, FlagValueOf } from "./types.js";

export type FlagValues<T extends FlagRegistry> = Partial<{
	[K in keyof T]: FlagValueOf<T, K>;
}>;

/**
 * A resolver that answers from a fixed map, falling back to each flag's declared
 * `fallback` for keys left unset.
 *
 * Use this in consumers' tests instead of standing up real sources: flags
 * multiply a test matrix, and the multiplication is only tolerable if pinning a
 * value is one line.
 */
export function withFlags<T extends FlagRegistry>(
	flags: T,
	values: FlagValues<T> = {},
): Resolver<T> {
	return createResolver({
		flags,
		sources: [
			{
				name: "withFlags",
				decide: ({ key }) => values[key],
			},
		],
	});
}
