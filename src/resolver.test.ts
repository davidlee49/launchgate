import { describe, expect, it, vi } from "vitest";
import { createResolver, defineFlags } from "./resolver.js";
import { withFlags } from "./testing.js";
import type { Decision, Source } from "./types.js";

const flags = defineFlags({
	newHomepage: {
		fallback: false,
		description: "Redesigned marketing homepage",
		overridable: true,
	},
	legacyExport: {
		fallback: true,
		description: "Kill switch for the old export path — safe state is ON",
	},
	renderPipeline: {
		fallback: "v1" as "v1" | "v2",
		description: "Which render pipeline a submitted job uses",
	},
});

function fixed(name: string, decision: Decision): Source {
	return { name, decide: () => decision };
}

function throwing(name: string, error = new Error("boom")): Source {
	return {
		name,
		decide: () => {
			throw error;
		},
	};
}

describe("chain ordering", () => {
	it("returns the first definite answer", async () => {
		const resolver = createResolver({
			flags,
			sources: [
				fixed("a", undefined),
				fixed("b", true),
				fixed("c", false),
			],
		});
		await expect(resolver.resolve("newHomepage")).resolves.toBe(true);
	});

	it("treats false as a decision, not as undecided", async () => {
		const resolver = createResolver({
			flags,
			sources: [fixed("a", false), fixed("b", true)],
		});
		await expect(resolver.resolve("newHomepage")).resolves.toBe(false);
	});

	it("does not consult later sources once one decides", async () => {
		const later = vi.fn(() => undefined);
		const resolver = createResolver({
			flags,
			sources: [fixed("a", true), { name: "later", decide: later }],
		});
		await resolver.resolve("newHomepage");
		expect(later).not.toHaveBeenCalled();
	});

	it("falls back when every source is undecided", async () => {
		const resolver = createResolver({
			flags,
			sources: [fixed("a", undefined), fixed("b", undefined)],
		});
		await expect(resolver.resolve("newHomepage")).resolves.toBe(false);
		await expect(resolver.resolve("legacyExport")).resolves.toBe(true);
	});

	it("falls back with no sources at all", async () => {
		const resolver = createResolver({ flags, sources: [] });
		await expect(resolver.resolve("renderPipeline")).resolves.toBe("v1");
	});
});

describe("failure handling", () => {
	it("aborts to the fallback when a source throws, and reports it", async () => {
		const onError = vi.fn();
		const resolver = createResolver({
			flags,
			sources: [throwing("db"), fixed("later", false)],
			onError,
		});

		// legacyExport's safe state is ON — a global fail-closed policy would get
		// this backwards and take down a working feature on a database blip.
		await expect(resolver.resolve("legacyExport")).resolves.toBe(true);
		expect(onError).toHaveBeenCalledWith(expect.any(Error), {
			flag: "legacyExport",
			source: "db",
		});
	});

	it("does not fall through to later sources after a throw", async () => {
		const later = vi.fn(() => false);
		const resolver = createResolver({
			flags,
			sources: [throwing("db"), { name: "later", decide: later }],
			onError: () => {},
		});
		await resolver.resolve("legacyExport");
		expect(later).not.toHaveBeenCalled();
	});

	it("rejects an answer whose type does not match the flag", async () => {
		const onError = vi.fn();
		const resolver = createResolver({
			flags,
			sources: [fixed("bad", "yes-please")],
			onError,
		});
		await expect(resolver.resolve("newHomepage")).resolves.toBe(false);
		expect(onError).toHaveBeenCalledWith(expect.any(TypeError), {
			flag: "newHomepage",
			source: "bad",
		});
	});

	it("throws on an unknown key — there is no fallback to degrade to", async () => {
		const resolver = createResolver({ flags, sources: [] });
		await expect(
			(resolver.resolve as (k: string) => Promise<unknown>)("nope"),
		).rejects.toThrow(/unknown flag/);
	});
});

describe("value-typed flags", () => {
	it("carries a non-boolean value through the chain", async () => {
		const resolver = createResolver({
			flags,
			sources: [fixed("beta", "v2")],
		});
		await expect(resolver.resolve("renderPipeline")).resolves.toBe("v2");
	});
});

describe("context", () => {
	it("passes the subject and arbitrary fields to sources", async () => {
		const seen: unknown[] = [];
		const resolver = createResolver({
			flags,
			sources: [
				{
					name: "spy",
					decide: (_flag, ctx) => {
						seen.push([ctx.subject, ctx.region]);
						return undefined;
					},
				},
			],
		});
		await resolver.resolve("newHomepage", { subject: "org_1", region: "eu" });
		expect(seen).toEqual([["org_1", "eu"]]);
	});

	it("works with no context — an anonymous visitor has no subject", async () => {
		const resolver = createResolver({
			flags,
			sources: [
				{ name: "needs-subject", decide: (_f, ctx) => (ctx.subject ? true : undefined) },
			],
		});
		await expect(resolver.resolve("newHomepage")).resolves.toBe(false);
	});
});

describe("withFlags", () => {
	it("answers from the map and falls back for unset keys", async () => {
		const resolver = withFlags(flags, { newHomepage: true });
		await expect(resolver.resolve("newHomepage")).resolves.toBe(true);
		await expect(resolver.resolve("renderPipeline")).resolves.toBe("v1");
	});

	it("pins every flag to its fallback when given nothing", async () => {
		const resolver = withFlags(flags);
		await expect(resolver.resolve("legacyExport")).resolves.toBe(true);
	});
});
