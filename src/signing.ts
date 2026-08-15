import type { FlagValue } from "./types.js";

// HMAC-SHA256 over Web Crypto — present on Workers and Node 18+, so the core
// imports nothing from Node and the same build runs on the edge (Decision 7).

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64urlFromBytes(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesFromB64url(value: string): Uint8Array {
	const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
	const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
	let key = keyCache.get(secret);
	if (!key) {
		key = crypto.subtle.importKey(
			"raw",
			encoder.encode(secret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);
		keyCache.set(secret, key);
	}
	return key;
}

async function signature(payload: string, secret: string): Promise<string> {
	const key = await hmacKey(secret);
	const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
	return b64urlFromBytes(new Uint8Array(signed));
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

function isFlagValue(value: unknown): value is FlagValue {
	return (
		typeof value === "boolean" ||
		typeof value === "string" ||
		(typeof value === "number" && Number.isFinite(value))
	);
}

/**
 * Mints the signed token that `cookieOverride` reads. Lives in the core rather
 * than the framework adapter so an adapter is only cookie plumbing.
 */
export async function signOverrides(
	overrides: Record<string, FlagValue>,
	secret: string,
): Promise<string> {
	const payload = b64urlFromBytes(encoder.encode(JSON.stringify(overrides)));
	return `${payload}.${await signature(payload, secret)}`;
}

/** Verifies and parses a token. Returns `undefined` for anything not genuinely signed. */
export async function readOverrides(
	token: string,
	secret: string,
): Promise<Record<string, FlagValue> | undefined> {
	const split = token.lastIndexOf(".");
	if (split < 1) return undefined;

	const payload = token.slice(0, split);
	const provided = token.slice(split + 1);

	let expected: string;
	try {
		expected = await signature(payload, secret);
	} catch {
		return undefined;
	}
	if (!timingSafeEqual(provided, expected)) return undefined;

	try {
		const parsed: unknown = JSON.parse(decoder.decode(bytesFromB64url(payload)));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return undefined;
		}
		const overrides: Record<string, FlagValue> = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (isFlagValue(value)) overrides[key] = value;
		}
		return overrides;
	} catch {
		return undefined;
	}
}
