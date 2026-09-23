/**
 * Same-origin EdgeOne Pages API proxy.
 *
 * The browser only contacts the Pages domain. This function forwards /api/v1/*
 * to the FastAPI backend, keeps JWT tokens in HttpOnly cookies, and refreshes
 * an expired access token once before retrying the request.
 */

const DEFAULT_BACKEND_URL = "http://cfc8522bc8db.ofalias.net:44956";
const API_PREFIX = "/api/v1";
const ACCESS_COOKIE = "fztbu_access";
const REFRESH_COOKIE = "fztbu_refresh";
const ACCESS_MAX_AGE = 15 * 60;
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60;
const REQUEST_TIMEOUT_MS = 15_000;

const AUTH_PATHS_WITHOUT_TOKEN = [
  "/auth/login",
  "/auth/login-email",
  "/auth/login-json",
  "/auth/register",
  "/auth/send-code",
  "/auth/forgot-password",
  "/auth/oauth/github",
];

const BLOCKED_RESPONSE_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "set-cookie",
  "set-cookie2",
  "transfer-encoding",
  "upgrade",
]);

export async function onRequest(context) {
  const { request, env } = context;
  const requestUrl = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": requestUrl.origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const backendUrl = String(env.BACKEND_URL || DEFAULT_BACKEND_URL).replace(/\/+$/, "");
  const cookies = parseCookies(request.headers.get("cookie"));
  const path = normalizeApiPath(requestUrl.pathname);
  const secure = requestUrl.protocol === "https:";
  const requestBody =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer();

  try {
    if (path === "/auth/refresh") {
      return await handleRefreshOnly(request, backendUrl, cookies, secure);
    }

    const skipAuth = shouldSkipAuth(path, requestBody);
    let upstream = await callBackend({
      request,
      backendUrl,
      path,
      search: requestUrl.search,
      body: requestBody,
      accessToken: skipAuth ? null : cookies[ACCESS_COOKIE] || null,
    });

    let authPair = null;
    let clearAuth = false;

    if (
      upstream.status === 401 &&
      !skipAuth &&
      cookies[REFRESH_COOKIE]
    ) {
      authPair = await refreshPair(backendUrl, cookies[REFRESH_COOKIE]);
      if (authPair) {
        upstream = await callBackend({
          request,
          backendUrl,
          path,
          search: requestUrl.search,
          body: requestBody,
          accessToken: authPair.accessToken,
        });
      } else {
        clearAuth = true;
      }
    }

    if (path === "/auth/logout") {
      clearAuth = true;
    }

    const response = await forwardResponse(upstream, {
      path,
      secure,
      authPair,
      clearAuth,
    });
    return response;
  } catch (error) {
    return jsonResponse(
      {
        message: "后端连接失败，请确认 FRP 后端正在运行且 Pages 可访问该地址。",
        errorCode: "BACKEND_UNAVAILABLE",
        detail: error instanceof Error ? error.message : String(error),
      },
      502,
    );
  }
}

function normalizeApiPath(pathname) {
  const path = pathname.startsWith(API_PREFIX)
    ? pathname.slice(API_PREFIX.length)
    : pathname.slice("/api".length);
  return path || "/";
}

function shouldSkipAuth(path, body) {
  if (AUTH_PATHS_WITHOUT_TOKEN.some((prefix) => path.startsWith(prefix))) {
    return true;
  }

  if (path === "/auth/2fa/verify" && body?.byteLength) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(body));
      return parsed?.mode !== "setup";
    } catch {
      return false;
    }
  }

  return false;
}

async function callBackend({
  request,
  backendUrl,
  path,
  search,
  body,
  accessToken,
}) {
  const headers = new Headers();
  const accept = request.headers.get("accept");
  const contentType = request.headers.get("content-type");

  headers.set("Accept", accept || "application/json");
  if (contentType) headers.set("Content-Type", contentType);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  return fetchWithTimeout(`${backendUrl}${API_PREFIX}${path}${search || ""}`, {
    method: request.method,
    headers,
    body,
    redirect: "follow",
    cache: "no-store",
  });
}

async function refreshPair(backendUrl, refreshToken) {
  try {
    const response = await fetchWithTimeout(`${backendUrl}${API_PREFIX}/auth/refresh`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    });

    if (!response.ok) return null;
    const body = await response.json();
    if (!body?.accessToken || !body?.refreshToken) return null;
    return body;
  } catch {
    return null;
  }
}

async function handleRefreshOnly(request, backendUrl, cookies, secure) {
  const refreshToken = cookies[REFRESH_COOKIE];
  if (!refreshToken) {
    return jsonResponse({ message: "未登录", errorCode: "UNAUTHORIZED" }, 401);
  }

  const pair = await refreshPair(backendUrl, refreshToken);
  if (!pair) {
    const headers = new Headers();
    appendHeaders(headers, clearCookieHeaders(secure));
    return jsonResponse(
      { message: "会话已过期", errorCode: "UNAUTHORIZED" },
      401,
      headers,
    );
  }

  const headers = new Headers();
  appendHeaders(headers, authCookieHeaders(pair, secure));
  return jsonResponse(
    { ok: true, expiresIn: pair.expiresIn ?? ACCESS_MAX_AGE },
    200,
    headers,
  );
}

async function forwardResponse(upstream, { path, secure, authPair, clearAuth }) {
  const headers = copyResponseHeaders(upstream.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Vary", "Cookie, Authorization");

  if (authPair) {
    appendHeaders(headers, authCookieHeaders(authPair, secure));
  } else if (clearAuth) {
    appendHeaders(headers, clearCookieHeaders(secure));
  }

  if (isTokenResponsePath(path)) {
    const body = await readJsonSafely(upstream);

    if (authPair || (body?.accessToken && body?.refreshToken)) {
      const pair = authPair || body;
      appendHeaders(headers, authCookieHeaders(pair, secure));
      return jsonResponse(
        {
          ok: true,
          requires2FA: false,
          twoFactorToken: null,
          expiresIn: pair.expiresIn ?? ACCESS_MAX_AGE,
        },
        upstream.status,
        headers,
      );
    }

    return jsonResponse(
      {
        ok: upstream.ok,
        requires2FA: Boolean(body?.requires2Fa),
        twoFactorToken: body?.twoFactorToken ?? null,
        message: body?.message,
        errorCode: body?.errorCode,
      },
      upstream.status,
      headers,
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

function isTokenResponsePath(path) {
  return (
    path === "/auth/login" ||
    path === "/auth/login-email" ||
    path === "/auth/login-json" ||
    path === "/auth/2fa/verify"
  );
}

async function readJsonSafely(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function copyResponseHeaders(source) {
  const headers = new Headers();
  for (const [key, value] of source.entries()) {
    if (!BLOCKED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }
  return headers;
}

function authCookieHeaders(pair, secure) {
  return [
    serializeCookie(ACCESS_COOKIE, pair.accessToken, {
      maxAge: Number(pair.expiresIn) > 0 ? Number(pair.expiresIn) : ACCESS_MAX_AGE,
      secure,
    }),
    serializeCookie(REFRESH_COOKIE, pair.refreshToken, {
      maxAge: REFRESH_MAX_AGE,
      secure,
    }),
  ];
}

function clearCookieHeaders(secure) {
  return [
    serializeCookie(ACCESS_COOKIE, "", { maxAge: 0, secure }),
    serializeCookie(REFRESH_COOKIE, "", { maxAge: 0, secure }),
  ];
}

function serializeCookie(name, value, { maxAge, secure }) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;

  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }

  return cookies;
}

function appendHeaders(target, values) {
  for (const value of values) {
    target.append("Set-Cookie", value);
  }
}

function jsonResponse(body, status = 200, headers = new Headers()) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  responseHeaders.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
