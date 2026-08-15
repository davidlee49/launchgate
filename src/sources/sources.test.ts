import { describe, expect, it, vi } from "vitest";
import { createResolver, defineFlags } from "../resolver.js";
import { signOverrides } from "../signing.js";
import { cookieOverride, DEFAULT_OVERRIDE_COOKIE } from "./cookie.js";
import { envDefault, envOverride } from "./env.js";

const SECRET = "test-secret";

const flags = defineFlags({
	newHomepage: {
		fallback: false,
		description: "Redesigned marketing homepage",
		overridable: true,
		byEnv: { development: true },
	},
	orgNetwork: {
		fallback: false,
		description: "Tenant-scoped feature — never visitor-overridable",
	},
	renderPipeline: {
		fallback: "v1" as "v1" | "v2",
		description: "Which render pipeline a submitted job uses",
		overridable: true,
	},
	maxUploads: {
		fallback: 10,
		description: "Concurrent upload ceiling",
	},
});

function cookieJar(token: string | undefined, name = DEFAULT_OVERRIDE_COOKIE) {
	return (wanted: string) => (wanted === name ? token : undefined);
}

describe("envOverride", () => {
	const env = (vars: Record<string, string>) =>
		envOverride({ read: (name) => vars[name] });

	it("maps a camelCase key to a SCREAMING_SNAKE variable", async () => {
		const resolver = createResolver({
			flags,
			sources: [env({ FLAG_NEW_HOMEPAGE: "on" })],
		});
		await expect(resolver.resolve("newHomepage")).resolves.toBe(true);
	});

	it("accepts off/false/0/no as off", async () => {
		for (const raw of ["off", "false", "0", "no", "OFF"]) {
			const resolver = createResolver({
				flags,
				sources: [env({ FLAG_ORG_NETWORK: raw }), { name: "on", decide: () => true }],
			});
			await expect(resolver.resolve("orgNetwork")).resolves.toBe(false);
		}
	});

	it("is undecided when the variable is unset or empty", async () => {
		const resolver = createResolver({
			flags,
			sources: [env({ FLAG_NEW_HOMEPAGE: "" }), { name: "next", decide: () => true }],
		});
		await expect(resolver.resolve("newHomepage")).resolves.toBe(true);
	});

	it("carries string and number values, not just booleans", async () => {
		const resolver = createResolver({
			flags,
			sources: [env({ FLAG_RENDER_PIPELINE: "v2", FLAG_MAX_UPLOADS: "25" })],
		});
		await expect(resolver.resolve("renderPipeline")).resolves.toBe("v2");
		await expect(resolver.resolve("maxUploads")).resolves.toBe(25);
	});

	it("reports an unparseable value loudly instead of ignoring it", async () => {
		const onError = vi.fn();
		const resolver = createResolver({
			flags,
			sources: [env({ FLAG_NEW_HOMEPAGE: "maybe" })],
			onError,
		});
		await expect(resolver.resolve("newHomepage")).resolves.toBe(false);
		expect(onError).toHaveBeenCalledWith(expect.any(Error), {
			flag: "newHomepage",
			source: "envOverride",
		});
	});
});

describe("envDefault", () => {
	it("returns the per-environment value", async () => {
		const resolver = createResolver({
			flags,
			sources: [envDefault({ env: "development" })],
		});
		await expect(resolver.resolve("newHomepage")).resolves.toBe(true);
	});

	it("is undecided for an environment the flag does not list", async () => {
		const resolver = createResolver({
			flags,
			sources: [envDefault({ env: "production" })],
		});
		await expect(resolver.resolve("newHomepage")).resolves.toBe(false);
	});

	it("accepts a lazy env, for runtimes with no module-scope process.env", async () => {
		let current = "production";
		const resolver = createResolver({
			flags,
			sources: [envDefault({ env: () => current })],
		});
		await expect(resolver.resolve("newHomepage")).resolves.toBe(false);
		current = "development";
		await expect(resolver.resolve("newHomepage")).resolves.toBe(true);
	});
});

describe("cookieOverride", () => {
	it("forces a flag for a visitor holding a signed token", async () => {
		const token = await signOverrides({ newHomepage: true }, SECRET);
		const resolver = createResolver({
			flags,
			sources: [cookieOverride({ secret: SECRET })],
		});
		await expect(
			resolver.resolve("newHomepage", { cookie: cookieJar(token) }),
		).resolves.toBe(true);
	});

	it("ignores flags that are not overridable", async () => {
		const token = await signOverrides({ orgNetwork: true }, SECRET);
		const resolver = createResolver({
			flags,
			sources: [cookieOverride({ secret: SECRET })],
		});
		await expect(
			resolver.resolve("orgNetwork", { cookie: cookieJar(token) }),
		).resolves.toBe(false);
	});

	it("is undecided for a tampered payload", async () => {
		// The real attack: keep a genuine signature, swap the value it covers.
		const token = await signOverrides({ newHomepage: false }, SECRET);
		const [, signature] = token.split(".");
		const forgedPayload = btoa('{"newHomepage":true}')
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
		const forged = `${forgedPayload}.${signature}`;
		const resolver = createResolver({
			flags,
			sources: [cookieOverride({ secret: SECRET })],
		});
		await expect(
			resolver.resolve("newHomepage", { cookie: cookieJar(forged) }),
		).resolves.toBe(false);
	});

	it("is undecided for a token signed with another secret", async () => {
		const token = await signOverrides({ newHomepage: true }, "other-secret");
		const resolver = createResolver({
			flags,
			sources: [cookieOverride({ secret: SECRET })],
		});
		await expect(
			resolver.resolve("newHomepage", { cookie: cookieJar(token) }),
		).resolves.toBe(false);
	});

	it("is undecided for junk, and never throws", async () => {
		const resolver = createResolver({
			flags,
			sources: [cookieOverride({ secret: SECRET })],
		});
		for (const junk of ["", "no-dot", ".", "a.b", "!!!.???"]) {
			await expect(
				resolver.resolve("newHomepage", { cookie: cookieJar(junk) }),
			).resolves.toBe(false);
		}
	});

	it("is undecided when the request has no cookies at all", async () => {
		const resolver = createResolver({
			flags,
			sources: [cookieOverride({ secret: SECRET })],
		});
		await expect(resolver.resolve("newHomepage")).resolves.toBe(false);
	});

	it("carries a value override, not only on/off", async () => {
		const token = await signOverrides({ renderPipeline: "v2" }, SECRET);
		const resolver = createResolver({
			flags,
			sources: [cookieOverride({ secret: SECRET })],
		});
		await expect(
			resolver.resolve("renderPipeline", { cookie: cookieJar(token) }),
		).resolves.toBe("v2");
	});
});

describe("the two invariants", () => {
	it("envOverride outranks cookieOverride — a kill switch cannot be cookied around", async () => {
		const token = await signOverrides({ newHomepage: true }, SECRET);
		const resolver = createResolver({
			flags,
			sources: [
				envOverride({ read: (n) => (n === "FLAG_NEW_HOMEPAGE" ? "off" : undefined) }),
				cookieOverride({ secret: SECRET }),
			],
		});
		await expect(
			resolver.resolve("newHomepage", { cookie: cookieJar(token) }),
		).resolves.toBe(false);
	});

	it("cookieOverride outranks envDefault — the author sees hidden work in production", async () => {
		const token = await signOverrides({ newHomepage: true }, SECRET);
		const resolver = createResolver({
			flags,
			sources: [
				envOverride({ read: () => undefined }),
				cookieOverride({ secret: SECRET }),
				envDefault({ env: "production" }),
			],
		});
		await expect(resolver.resolve("newHomepage")).resolves.toBe(false);
		await expect(
			resolver.resolve("newHomepage", { cookie: cookieJar(token) }),
		).resolves.toBe(true);
	});
});
