import {
  DEFAULT_OVERRIDE_COOKIE,
  readOverrides,
  signOverrides
} from "../chunk-34MIJ7KP.js";

// src/next/index.ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
async function requestContext(extra = {}) {
  const jar = await cookies();
  return { ...extra, cookie: (name) => jar.get(name)?.value };
}
async function requireFlag(resolver, key, ctx) {
  const value = await resolver.resolve(key, ctx);
  return value === false || value === void 0 ? NextResponse.json({ error: "Not found" }, { status: 404 }) : null;
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function parseAs(raw, fallback) {
  if (typeof fallback === "boolean") {
    const v = raw.trim().toLowerCase();
    if (v === "on" || v === "true" || v === "1") return true;
    if (v === "off" || v === "false" || v === "0") return false;
    return void 0;
  }
  if (typeof fallback === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : void 0;
  }
  return raw;
}
function createOverrideRoute(options) {
  const { resolver, secret, accessToken } = options;
  const cookieName = options.cookieName ?? DEFAULT_OVERRIDE_COOKIE;
  const maxAge = options.maxAge ?? 60 * 60 * 24 * 30;
  async function GET(request) {
    const url = new URL(request.url);
    const token = url.searchParams.get("token") ?? "";
    if (!timingSafeEqual(token, accessToken)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const jar = await cookies();
    const current = jar.get(cookieName)?.value;
    let overrides = (current ? await readOverrides(current, secret) : void 0) ?? {};
    if (url.searchParams.get("clear") !== null) {
      overrides = {};
    } else {
      const key = url.searchParams.get("flag");
      if (!key) {
        return NextResponse.json({ error: "flag is required" }, { status: 400 });
      }
      const def = resolver.flags[key];
      if (!def) {
        return NextResponse.json({ error: `unknown flag "${key}"` }, { status: 400 });
      }
      if (!def.overridable) {
        return NextResponse.json(
          { error: `flag "${key}" is not overridable` },
          { status: 400 }
        );
      }
      const raw = url.searchParams.get("value");
      if (raw === null) {
        delete overrides[key];
      } else {
        const value = parseAs(raw, def.fallback);
        if (value === void 0) {
          return NextResponse.json(
            { error: `"${raw}" is not a valid value for "${key}"` },
            { status: 400 }
          );
        }
        overrides[key] = value;
      }
    }
    const body = { overrides };
    const response = NextResponse.json(body);
    if (Object.keys(overrides).length === 0) {
      response.cookies.delete(cookieName);
    } else {
      response.cookies.set(cookieName, await signOverrides(overrides, secret), {
        httpOnly: true,
        sameSite: "lax",
        secure: url.protocol === "https:",
        path: "/",
        maxAge
      });
    }
    return response;
  }
  return { GET };
}
export {
  createOverrideRoute,
  requestContext,
  requireFlag
};
