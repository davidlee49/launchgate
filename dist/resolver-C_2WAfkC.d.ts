/** What a flag can resolve to. Boolean is the common case, not the only one (Decision 1). */
type FlagValue = boolean | string | number;
interface FlagDef<T extends FlagValue = FlagValue> {
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
type FlagRegistry = Record<string, FlagDef>;
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
type FlagValueOf<T extends FlagRegistry, K extends keyof T> = T[K]["fallback"] extends boolean ? boolean : T[K]["fallback"];
/**
 * Data a source may target on. Named for OpenFeature's evaluation context, and
 * `targetingKey` is its field — the CNCF spec every major SDK implements, so
 * this reads as a familiar dialect rather than a private vocabulary.
 *
 * `targetingKey` is **optional** by design, where OpenFeature makes it merely
 * conventional: an anonymous visitor to a static site has none, and a launch
 * gate must still resolve for them.
 */
interface EvaluationContext {
    /** Who is being evaluated — a user id, org id, device id. Absent for anonymous visitors. */
    targetingKey?: string;
    /** Reads a request cookie. Supplied by a framework adapter; absent means "no cookies here". */
    cookie?: (name: string) => string | undefined;
    /** Anything else a project-supplied source needs. */
    [key: string]: unknown;
}
/** @deprecated Renamed to `EvaluationContext` in 0.3.0 to match OpenFeature. */
type Context = EvaluationContext;
/** A source's answer. `undefined` means *undecided — ask the next source* (Decision 2). */
type Decision = FlagValue | undefined;
interface FlagMeta {
    key: string;
    def: FlagDef;
}
/**
 * One link in the resolution chain. Sources are typed against `unknown` values
 * rather than the registry's inferred types (Decision 8) — the call site keeps
 * its types, the four built-in sources give theirs up.
 */
interface Source {
    /** Reported to `onError` when this source throws. */
    readonly name: string;
    decide(flag: FlagMeta, ctx: Context): Decision | Promise<Decision>;
}
interface SourceErrorInfo {
    flag: string;
    source: string;
}

/**
 * Declares a project's flags. Identity at runtime; it exists to infer each flag's
 * value type so `resolve()` is typed at the call site.
 *
 * The registry lives in the project that reads the flags, not in a table and not
 * in library config (Decision 4): flags ship with the code they gate, so deleting
 * one is a pull request and a key nobody reads is visibly dead.
 */
declare function defineFlags<T extends FlagRegistry>(flags: T): T;
interface ResolverOptions<T extends FlagRegistry> {
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
type ResolvedFlags<T extends FlagRegistry> = {
    [K in keyof T]: FlagValueOf<T, K>;
};
interface Resolver<T extends FlagRegistry> {
    resolve<K extends keyof T & string>(key: K, ctx?: EvaluationContext): Promise<FlagValueOf<T, K>>;
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
declare function createResolver<T extends FlagRegistry>(options: ResolverOptions<T>): Resolver<T>;

export { type Context as C, type Decision as D, type EvaluationContext as E, type FlagValue as F, type Resolver as R, type Source as S, type FlagMeta as a, type FlagRegistry as b, type FlagValueOf as c, type FlagDef as d, type ResolvedFlags as e, type ResolverOptions as f, type SourceErrorInfo as g, createResolver as h, defineFlags as i };
