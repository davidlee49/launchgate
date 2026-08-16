import { describe, expect, it, vi } from "vitest";
import { defineFlags } from "./resolver.js";
import { createRouteGate, matchesPrefix } from "./route-gate.js";
import { withFlags } from "./testing.js";

const flags = defineFlags({
	workflows: { fallback: false, description: "Workflows", overridable: true },
	network: { fallback: false, description: "Network", overridable: true },
});

const ROUTES = {
	workflows: ["/workflows"],
	network: ["/network", "/api/network"],
} as const;

const ALLOW = ["/", "/assets", "/api/assets"];

function gate(on: Partial<Record<"workflows" | "network", boolean>> = {}) {
	return createRouteGate({
		resolver: withFlags(flags, on),
		routes: ROUTES,
		allow: ALLOW,
		unlisted: "deny",
	});
}

describe("matchesPrefix", () => {
	it("matches exactly and below", () => {
		expect(matchesPrefix("/assets", ["/assets"])).toBe(true);
		expect(matchesPrefix("/assets/123", ["/assets"])).toBe(true);
	});

	it("does not match a longer sibling segment", () => {
		expect(matchesPrefix("/assetsomething", ["/assets"])).toBe(false);
	});

	it("treats '/' as the root only, with no special case", () => {
		expect(matchesPrefix("/", ["/"])).toBe(true);
		expect(matchesPrefix("/assets", ["/"])).toBe(false);
	});
});

describe("createRouteGate", () => {
	it("serves an allowlisted path", async () => {
		await expect(gate().isPermitted("/assets/123")).resolves.toBe(true);
	});

	it("denies a flagged path while its flag is off", async () => {
		await expect(gate().isPermitted("/workflows")).resolves.toBe(false);
	});

	it("serves a flagged path once its flag is on", async () => {
		await expect(gate({ workflows: true }).isPermitted("/workflows/runs/1")).resolves.toBe(true);
	});

	it("reveals only the flag that is on", async () => {
		const g = gate({ workflows: true });
		await expect(g.isPermitted("/workflows")).resolves.toBe(true);
		await expect(g.isPermitted("/network")).resolves.toBe(false);
	});

	it("reveals every prefix a single flag covers", async () => {
		const g = gate({ network: true });
		await expect(g.isPermitted("/network")).resolves.toBe(true);
		await expect(g.isPermitted("/api/network")).resolves.toBe(true);
	});

	describe("unlisted paths", () => {
		it("deny: a route nobody has listed is hidden", async () => {
			await expect(gate().isPermitted("/brand-new")).resolves.toBe(false);
		});

		it("allow: the same route ships", async () => {
			const g = createRouteGate({
				resolver: withFlags(flags),
				routes: ROUTES,
				allow: ALLOW,
				unlisted: "allow",
			});
			await expect(g.isPermitted("/brand-new")).resolves.toBe(true);
			// A flag that is off still wins over an "allow" posture — otherwise
			// `unlisted: "allow"` would quietly un-hide everything.
			await expect(g.isPermitted("/workflows")).resolves.toBe(false);
		});

		it("works with no allowlist at all — pure denylist", async () => {
			const g = createRouteGate({
				resolver: withFlags(flags, { workflows: true }),
				routes: ROUTES,
				unlisted: "allow",
			});
			await expect(g.isPermitted("/anything")).resolves.toBe(true);
			await expect(g.isPermitted("/workflows")).resolves.toBe(true);
			await expect(g.isPermitted("/network")).resolves.toBe(false);
		});
	});

	it("does not resolve any flag for an allowlisted path", async () => {
		const resolve = vi.fn(async () => false);
		const g = createRouteGate({
			resolver: { flags, resolve } as never,
			routes: ROUTES,
			allow: ALLOW,
			unlisted: "deny",
		});
		await g.isPermitted("/assets");
		expect(resolve).not.toHaveBeenCalled();
	});

	it("reports the prefixes it would serve", async () => {
		const g = gate({ workflows: true });
		await expect(g.revealedPrefixes()).resolves.toEqual(["/workflows"]);
		await expect(g.permittedPrefixes()).resolves.toEqual([...ALLOW, "/workflows"]);
	});

	describe("construction guards", () => {
		it("rejects a prefix that is both allowed and flagged — the flag would be dead", () => {
			expect(() =>
				createRouteGate({
					resolver: withFlags(flags),
					routes: { workflows: ["/workflows"] },
					allow: ["/workflows"],
					unlisted: "deny",
				}),
			).toThrow(/both allowed and gated/);
		});

		it("rejects routes naming a flag that does not exist", () => {
			expect(() =>
				createRouteGate({
					resolver: withFlags(flags),
					routes: { nope: ["/nope"] } as never,
					unlisted: "deny",
				}),
			).toThrow(/unknown flag/);
		});
	});
});
