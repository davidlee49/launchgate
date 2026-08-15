// src/signing.ts
var encoder = new TextEncoder();
var decoder = new TextDecoder();
function b64urlFromBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function bytesFromB64url(value) {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
var keyCache = /* @__PURE__ */ new Map();
function hmacKey(secret) {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    keyCache.set(secret, key);
  }
  return key;
}
async function signature(payload, secret) {
  const key = await hmacKey(secret);
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return b64urlFromBytes(new Uint8Array(signed));
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function isFlagValue(value) {
  return typeof value === "boolean" || typeof value === "string" || typeof value === "number" && Number.isFinite(value);
}
async function signOverrides(overrides, secret) {
  const payload = b64urlFromBytes(encoder.encode(JSON.stringify(overrides)));
  return `${payload}.${await signature(payload, secret)}`;
}
async function readOverrides(token, secret) {
  const split = token.lastIndexOf(".");
  if (split < 1) return void 0;
  const payload = token.slice(0, split);
  const provided = token.slice(split + 1);
  let expected;
  try {
    expected = await signature(payload, secret);
  } catch {
    return void 0;
  }
  if (!timingSafeEqual(provided, expected)) return void 0;
  try {
    const parsed = JSON.parse(decoder.decode(bytesFromB64url(payload)));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return void 0;
    }
    const overrides = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isFlagValue(value)) overrides[key] = value;
    }
    return overrides;
  } catch {
    return void 0;
  }
}

// src/sources/cookie.ts
var DEFAULT_OVERRIDE_COOKIE = "lg_override";
function cookieOverride(options) {
  const { secret } = options;
  const cookieName = options.cookieName ?? DEFAULT_OVERRIDE_COOKIE;
  return {
    name: "cookieOverride",
    async decide({ key, def }, ctx) {
      if (!def.overridable) return void 0;
      const token = ctx.cookie?.(cookieName);
      if (!token) return void 0;
      const overrides = await readOverrides(token, secret);
      return overrides?.[key];
    }
  };
}

export {
  signOverrides,
  readOverrides,
  DEFAULT_OVERRIDE_COOKIE,
  cookieOverride
};
