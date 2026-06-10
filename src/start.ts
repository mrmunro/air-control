import { createStart, createMiddleware } from "@tanstack/react-start";
import process from "node:process";

import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

const ACCESS_COOKIE = "lv_access";
const ACCESS_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function isStaticAssetPath(path: string): boolean {
  return (
    path.startsWith("/_build/") ||
    path.startsWith("/assets/") ||
    path.startsWith("/_server/") ||
    path.startsWith("/__") ||
    path.startsWith("/@") ||
    path === "/favicon.ico" ||
    path === "/robots.txt" ||
    /\.[a-z0-9]{2,5}$/i.test(path)
  );
}

function hasAccessCookie(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  return cookieHeader
    .split(";")
    .map((c) => c.trim())
    .some((c) => c === `${ACCESS_COOKIE}=1`);
}

function renderAccessDeniedPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <title>Access Denied</title>
    <style>
      :root { color-scheme: dark; }
      html,body { height:100%; margin:0; }
      body {
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        background:#0b0f17; color:#e5e7eb;
        display:flex; align-items:center; justify-content:center; padding:24px;
      }
      main { max-width: 480px; text-align:center; }
      h1 { font-size: 24px; margin: 0 0 12px; letter-spacing: -0.01em; }
      p  { margin: 0; color:#9ca3af; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main>
      <h1>Access denied</h1>
      <p>This engine is restricted. A valid access token is required to continue.</p>
    </main>
  </body>
</html>`;
}

const accessGateMiddleware = createMiddleware().server(
  async ({ next, request }) => {
    const token = process.env.BYPASS_TOKEN;
    // If no token is configured on the server, leave the app open (dev/local).
    if (!token) return next();

    const url = new URL(request.url);
    const path = url.pathname;

    if (isStaticAssetPath(path)) return next();

    const cookieHeader = request.headers.get("cookie");
    const provided = url.searchParams.get("access");

    // Grant access: set cookie and redirect to a clean URL (strips ?access=).
    if (provided && provided === token) {
      url.searchParams.delete("access");
      const location = url.pathname + (url.search ? url.search : "") + url.hash;
      return new Response(null, {
        status: 302,
        headers: {
          Location: location,
          "Set-Cookie": `${ACCESS_COOKIE}=1; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${ACCESS_COOKIE_MAX_AGE}`,
        },
      });
    }

    if (hasAccessCookie(cookieHeader)) return next();

    // Deny.
    if (path.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "Access denied" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(renderAccessDeniedPage(), {
      status: 403,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  },
);

export const startInstance = createStart(() => ({
  requestMiddleware: [accessGateMiddleware, errorMiddleware],
}));
