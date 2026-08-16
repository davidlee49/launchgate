import { S as Source, F as FlagMeta, a as FlagValue, C as Context, b as FlagRegistry, R as Resolver, c as FlagValueOf } from './resolver-DjTGv8b9.js';
export { D as Decision, d as FlagDef, e as ResolverOptions, f as SourceErrorInfo, g as createResolver, h as defineFlags } from './resolver-DjTGv8b9.js';

interface EnvOverrideOptions {
    /** How to read an environment variable. Defaults to `process.env` where it exists. */
    read?: (name: string) => string | undefined;
    /** Variable-name prefix. Default `FLAG_`. */
    prefix?: string;
}
/**
 * Slot 1 — the operator override, whose primary use is the kill switch.
 *
 * `FLAG_NEW_HOMEPAGE=off` forces a flag off; any value the flag's type accepts
 * forces that value. This sits **above** `cookieOverride` deliberately: a flag
 * forced on by a visitor cookie must not survive the attempt to kill it.
 *
 * An unparseable value throws, which aborts to the flag's fallback and reports
 * through `onError` — an operator typo is loud rather than silently ignored.
 */
declare function envOverride(options?: EnvOverrideOptions): Source;
interface EnvDefaultOptions {
    /** The current environment name, matched against each flag's `byEnv`. */
    env: string | (() => string);
}
/**
 * Slot 4 — the registry's per-environment value, e.g. `byEnv: { development: true }`.
 *
 * This is also the whole of "preview deployments": a preview host is just a
 * different `env` with different values, needing no runtime machinery.
 */
declare function envDefault(options: EnvDefaultOptions): Source;

declare const DEFAULT_OVERRIDE_COOKIE = "lg_override";
interface CookieOverrideOptions {
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
declare function cookieOverride(options: CookieOverrideOptions): Source;

/**
 * What storage knows about one subject and one flag.
 *
 * `override` is written only by the platform side. `'disabled'` is the per-subject
 * kill switch, `'enabled'` the grant (beta cohort, comp, early access) — and they
 * sit in *different* slots of the chain, which is why they are one row but two
 * sources.
 */
interface SubjectState {
    override?: "enabled" | "disabled";
    /** Grant a specific value rather than `true`. For value-typed flags. */
    value?: FlagValue;
    /** Has the subject switched it on themselves? */
    optedIn?: boolean;
    /**
     * Projects may return their own fields alongside these and read them back via
     * `store.state()` — impartire's loader returns the org's `is_platform` here so
     * its stage policy shares this read instead of issuing a second query.
     */
    [projectField: string]: unknown;
}
type LoadSubjectState = (subject: string, key: string, flag: FlagMeta) => Promise<SubjectState | undefined> | SubjectState | undefined;
interface SubjectStoreOptions {
    load: LoadSubjectState;
    /**
     * Flags the subject must switch on for themselves — entitlement alone isn't
     * enough. Default: none.
     */
    requiresOptIn?: (flag: FlagMeta) => boolean;
}
interface SubjectStore {
    /** Slot 1, beside `envOverride`. A per-subject kill outranks a visitor cookie. */
    kill: Source;
    /** Slot 3a. Vetoes a flag the subject hasn't switched on. */
    requireOptIn: Source;
    /** Slot 3b. The platform's grant. */
    grant: Source;
    /**
     * The cached read, for a project's own policy source. Sharing it is what keeps
     * a bespoke rule from costing an extra query.
     */
    state(flag: FlagMeta, ctx: Context): Promise<SubjectState | undefined>;
}
/**
 * Three sources over one storage read.
 *
 * They share a cache keyed on the `Context` object, which is per request, so a
 * request pays **one** load per flag however many of the three are in the chain —
 * the alternative being the same row fetched three times.
 *
 * The library owns the semantics; you own the SQL. `load` returns whatever your
 * schema says; a row shape of `(subject_id, flag_key, override)` is all this needs.
 */
declare function subjectStore(options: SubjectStoreOptions): SubjectStore;

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
declare function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean;
interface RouteGateOptions<T extends FlagRegistry> {
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
interface RouteGate {
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
declare function createRouteGate<T extends FlagRegistry>(options: RouteGateOptions<T>): RouteGate;

/**
 * Mints the signed token that `cookieOverride` reads. Lives in the core rather
 * than the framework adapter so an adapter is only cookie plumbing.
 */
declare function signOverrides(overrides: Record<string, FlagValue>, secret: string): Promise<string>;
/** Verifies and parses a token. Returns `undefined` for anything not genuinely signed. */
declare function readOverrides(token: string, secret: string): Promise<Record<string, FlagValue> | undefined>;

type FlagValues<T extends FlagRegistry> = Partial<{
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
declare function withFlags<T extends FlagRegistry>(flags: T, values?: FlagValues<T>): Resolver<T>;

export { Context, type CookieOverrideOptions, DEFAULT_OVERRIDE_COOKIE, type EnvDefaultOptions, type EnvOverrideOptions, FlagMeta, FlagRegistry, FlagValue, type FlagValues, type LoadSubjectState, Resolver, type RouteGate, type RouteGateOptions, Source, type SubjectState, type SubjectStore, type SubjectStoreOptions, cookieOverride, createRouteGate, envDefault, envOverride, matchesPrefix, readOverrides, signOverrides, subjectStore, withFlags };
