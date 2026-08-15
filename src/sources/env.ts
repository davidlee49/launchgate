import type { FlagValue, Source } from "../types.js";

/** `newHomepage` → `NEW_HOMEPAGE`. Also tolerates kebab-case and snake_case keys. */
function envName(key: string): string {
	return key
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/[-\s]+/g, "_")
		.toUpperCase();
}

function parseAs(raw: string, fallback: FlagValue, variable: string): FlagValue {
	const trimmed = raw.trim();

	if (typeof fallback === "boolean") {
		const v = trimmed.toLowerCase();
		if (v === "on" || v === "true" || v === "1" || v === "yes") return true;
		if (v === "off" || v === "false" || v === "0" || v === "no") return false;
		throw new Error(
			`launchgate: ${variable}="${raw}" is not on/off for a boolean flag`,
		);
	}

	if (typeof fallback === "number") {
		const n = Number(trimmed);
		if (!Number.isFinite(n)) {
			throw new Error(`launchgate: ${variable}="${raw}" is not a number`);
		}
		return n;
	}

	return trimmed;
}

function defaultRead(name: string): string | undefined {
	// Reached through globalThis so the core imports nothing from Node and runs
	// unchanged on Workers, where `process` may not exist at all.
	const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
	return proc?.env?.[name];
}

export interface EnvOverrideOptions {
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
export function envOverride(options: EnvOverrideOptions = {}): Source {
	const read = options.read ?? defaultRead;
	const prefix = options.prefix ?? "FLAG_";

	return {
		name: "envOverride",
		decide({ key, def }) {
			const variable = prefix + envName(key);
			const raw = read(variable);
			if (raw === undefined || raw === "") return undefined;
			return parseAs(raw, def.fallback, variable);
		},
	};
}

export interface EnvDefaultOptions {
	/** The current environment name, matched against each flag's `byEnv`. */
	env: string | (() => string);
}

/**
 * Slot 4 — the registry's per-environment value, e.g. `byEnv: { development: true }`.
 *
 * This is also the whole of "preview deployments": a preview host is just a
 * different `env` with different values, needing no runtime machinery.
 */
export function envDefault(options: EnvDefaultOptions): Source {
	const { env } = options;

	return {
		name: "envDefault",
		decide({ def }) {
			const current = typeof env === "function" ? env() : env;
			return def.byEnv?.[current];
		},
	};
}
