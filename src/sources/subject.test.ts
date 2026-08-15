import { describe, expect, it, vi } from "vitest";
import { createResolver, defineFlags } from "../resolver.js";
import { signOverrides } from "../signing.js";
import { cookieOverride, DEFAULT_OVERRIDE_COOKIE } from "./cookie.js";
import { subjectStore, type SubjectState } from "./subject.js";

const SECRET = "test-secret";

const flags = defineFlags({
	network: {
		fallback: false,
		description: "Network routes and UI",
		overridable: true,
		selfServe: true,
	},
	sidecar: {
		fallback: false,
		description: "Sidecar surface — entitlement only, no opt-in",
	},
	pipeline: {
		fallback: "v1" as "v1" | "v2",
		description: "Render pipeline",
	},
});

function store(rows: Record<string, SubjectState>, onLoad?: () => void) {
	return subjectStore({
		load: (subject, key) => {
			onLoad?.();
			return rows[`${subject} ${key}`];
		},
		requiresOptIn: (flag) => flag.def.selfServe === true,
	});
}

function chain(rows: Record<string, SubjectState>, onLoad?: () => void) {
	const s = store(rows, onLoad);
	return createResolver({
		flags,
		sources: [s.kill, cookieOverride({ secret: SECRET }), s.requireOptIn, s.grant],
	});
}

describe("subjectStore", () => {
	it("is undecided with no subject — an anonymous visitor has no rows", async () => {
		const resolver = chain({ "org_1 sidecar": { override: "enabled" } });
		await expect(resolver.resolve("sidecar")).resolves.toBe(false);
	});

	it("is undecided when the subject has no row", async () => {
		const resolver = chain({});
		await expect(resolver.resolve("sidecar", { subject: "org_1" })).resolves.toBe(false);
	});

	it("grants on an 'enabled' row", async () => {
		const resolver = chain({ "org_1 sidecar": { override: "enabled" } });
		await expect(resolver.resolve("sidecar", { subject: "org_1" })).resolves.toBe(true);
	});

	it("kills on a 'disabled' row even when something later would grant", async () => {
		const s = store({ "org_1 sidecar": { override: "disabled" } });
		const resolver = createResolver({
			flags,
			sources: [s.kill, { name: "ga", decide: () => true }],
		});
		await expect(resolver.resolve("sidecar", { subject: "org_1" })).resolves.toBe(false);
	});

	it("grants a value, not only true", async () => {
		const resolver = chain({ "org_1 pipeline": { override: "enabled", value: "v2" } });
		await expect(resolver.resolve("pipeline", { subject: "org_1" })).resolves.toBe("v2");
	});

	describe("opt-in requirement", () => {
		it("vetoes an entitled flag the subject hasn't switched on", async () => {
			const s = store({ "org_1 network": { override: "enabled" } });
			const resolver = createResolver({
				flags,
				sources: [s.kill, s.requireOptIn, s.grant],
			});
			await expect(resolver.resolve("network", { subject: "org_1" })).resolves.toBe(false);
		});

		it("allows it once opted in", async () => {
			const s = store({ "org_1 network": { override: "enabled", optedIn: true } });
			const resolver = createResolver({
				flags,
				sources: [s.kill, s.requireOptIn, s.grant],
			});
			await expect(resolver.resolve("network", { subject: "org_1" })).resolves.toBe(true);
		});

		it("does not apply to flags outside requiresOptIn", async () => {
			const s = store({ "org_1 sidecar": { override: "enabled" } });
			const resolver = createResolver({
				flags,
				sources: [s.kill, s.requireOptIn, s.grant],
			});
			await expect(resolver.resolve("sidecar", { subject: "org_1" })).resolves.toBe(true);
		});

		it("vetoes an entitlement granted by a LATER source, which is why it sits ahead of it", async () => {
			const s = store({});
			const resolver = createResolver({
				flags,
				sources: [s.kill, s.requireOptIn, { name: "ga", decide: () => true }],
			});
			await expect(resolver.resolve("network", { subject: "org_1" })).resolves.toBe(false);
		});
	});

	describe("chain position", () => {
		it("a subject kill outranks a visitor cookie", async () => {
			const token = await signOverrides({ network: true }, SECRET);
			const resolver = chain({ "org_1 network": { override: "disabled" } });
			await expect(
				resolver.resolve("network", {
					subject: "org_1",
					cookie: (n) => (n === DEFAULT_OVERRIDE_COOKIE ? token : undefined),
				}),
			).resolves.toBe(false);
		});

		it("a cookie outranks the opt-in requirement, so a developer isn't blocked by it", async () => {
			const token = await signOverrides({ network: true }, SECRET);
			const resolver = chain({});
			await expect(
				resolver.resolve("network", {
					subject: "org_1",
					cookie: (n) => (n === DEFAULT_OVERRIDE_COOKIE ? token : undefined),
				}),
			).resolves.toBe(true);
		});
	});

	it("loads once per request however many of the three sources run", async () => {
		const onLoad = vi.fn();
		const resolver = chain({ "org_1 network": { override: "enabled", optedIn: true } }, onLoad);
		const ctx = { subject: "org_1" };
		await expect(resolver.resolve("network", ctx)).resolves.toBe(true);
		expect(onLoad).toHaveBeenCalledTimes(1);
	});

	it("loads again for a different request context", async () => {
		const onLoad = vi.fn();
		const resolver = chain({ "org_1 sidecar": { override: "enabled" } }, onLoad);
		await resolver.resolve("sidecar", { subject: "org_1" });
		await resolver.resolve("sidecar", { subject: "org_1" });
		expect(onLoad).toHaveBeenCalledTimes(2);
	});

	it("surfaces a storage failure as the flag's fallback, reported", async () => {
		const onError = vi.fn();
		const s = subjectStore({
			load: () => {
				throw new Error("neon is down");
			},
		});
		const resolver = createResolver({ flags, sources: [s.kill], onError });
		await expect(resolver.resolve("sidecar", { subject: "org_1" })).resolves.toBe(false);
		expect(onError).toHaveBeenCalledWith(expect.any(Error), {
			flag: "sidecar",
			source: "subjectKill",
		});
	});
});
