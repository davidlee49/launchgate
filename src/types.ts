// The vocabulary. See adr/0001-launch-gate-design.md.

/** What a flag can resolve to. Boolean is the common case, not the only one (Decision 1). */
export type FlagValue = boolean | string | number;

export interface FlagDef<T extends FlagValue = FlagValue> {
	/**
	 * The value used when no source decides, and when a source throws.
	 *
	 * Per flag, never global (Decision 3): a work-in-progress gate's safe state is
	 * `false`, but a kill switch on a year-old feature's safe state is `true` —
	 * failing that one closed would take down working functionality because a
	 * database blipped.
	 */
	fallback: T;
	/** Why this flag exists. Greppability plus this line is the whole flag-debt mitigation. */
	description: string;
	/** May a signed visitor cookie force this flag? Default false — see `cookieOverride`. */
	overridable?: boolean;
	/** Per-environment value, consulted by the `envDefault` source. */
	byEnv?: Record<string, T>;
	/**
	 * Projects may hang their own fields here — a stage, a tier, an owner — and
	 * read them back inside a custom source. The registry keeps their real types
	 * (`flags.network.stage` is a `string`); only the erased view a `Source` sees
	 * widens to `unknown`.
	 */
	[projectField: string]: unknown;
}

export type FlagRegistry = Record<string, FlagDef>;

/**
 * The type a flag resolves to.
 *
 * `fallback: false` infers as the *literal* `false` rather than `boolean`,
 * because `boolean` is itself `true | false` and TypeScript preserves a literal
 * whose contextual type contains it. Left alone, every boolean flag would be
 * unable to hold the opposite value. Strings and numbers do not have this
 * problem (their contextual types are not literal unions), so they keep whatever
 * the author declared — which is what makes `fallback: "v1" as "v1" | "v2"` work.
 */
export type FlagValueOf<
	T extends FlagRegistry,
	K extends keyof T,
> = T[K]["fallback"] extends boolean ? boolean : T[K]["fallback"];

/**
 * Data a source may target on. `subject` is OpenFeature's `targetingKey` and is
 * **optional** by design: an anonymous visitor to a static site has none.
 */
export interface Context {
	/** Who is being evaluated — a user id, org id, device id. Absent for anonymous visitors. */
	subject?: string;
	/** Reads a request cookie. Supplied by a framework adapter; absent means "no cookies here". */
	cookie?: (name: string) => string | undefined;
	/** Anything else a project-supplied source needs. */
	[key: string]: unknown;
}

/** A source's answer. `undefined` means *undecided — ask the next source* (Decision 2). */
export type Decision = FlagValue | undefined;

export interface FlagMeta {
	key: string;
	def: FlagDef;
}

/**
 * One link in the resolution chain. Sources are typed against `unknown` values
 * rather than the registry's inferred types (Decision 8) — the call site keeps
 * its types, the four built-in sources give theirs up.
 */
export interface Source {
	/** Reported to `onError` when this source throws. */
	readonly name: string;
	decide(flag: FlagMeta, ctx: Context): Decision | Promise<Decision>;
}

export interface SourceErrorInfo {
	flag: string;
	source: string;
}
