import type { Config } from "@netlify/functions";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users } from "../../db/schema.js";
import {
  SESSION_COOKIE,
  cookieHeader,
  endSession,
  getOrCreateDemoUser,
  readCookie,
  startSession,
} from "../../lib/session.js";

const STATE_COOKIE = "cl_oauth_state";

function redirect(location: string, cookies: string[] = []) {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function googleConfig() {
  const clientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

async function demoLogin(req: Request) {
  const userId = await getOrCreateDemoUser();
  return redirect("/dashboard", [await startSession(userId, readCookie(req, SESSION_COOKIE))]);
}

async function logout(req: Request) {
  return redirect("/", [await endSession(req)]);
}

function googleLogin(url: URL) {
  const google = googleConfig();
  if (!google) return redirect("/login?error=google_not_configured");

  const state = randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    client_id: google.clientId,
    redirect_uri: `${url.origin}/google-callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
  });

  return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, [
    cookieHeader(STATE_COOKIE, state, 600),
  ]);
}

async function googleCallback(req: Request, url: URL) {
  const google = googleConfig();
  if (!google) return redirect("/login");

  const clearState = cookieHeader(STATE_COOKIE, "", 0);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state || state !== readCookie(req, STATE_COOKIE)) {
    return redirect("/login?error=google_failed", [clearState]);
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: google.clientId,
        client_secret: google.clientSecret,
        redirect_uri: `${url.origin}/google-callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResponse.ok) throw new Error(`Token exchange failed: ${tokenResponse.status}`);
    const token = await tokenResponse.json();

    const infoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!infoResponse.ok) throw new Error(`Userinfo failed: ${infoResponse.status}`);
    const info = await infoResponse.json();

    const googleId: string | undefined = info.sub;
    const email: string | undefined = info.email;
    const name: string = info.name || "CareerNova User";
    const picture: string = info.picture || "";

    if (!googleId || !email) return redirect("/login?error=google_failed", [clearState]);

    const [user] = await db
      .insert(users)
      .values({ googleId, name, email, profilePhoto: picture })
      .onConflictDoUpdate({ target: users.googleId, set: { name, email, profilePhoto: picture } })
      .returning({ id: users.id });

    return redirect("/dashboard", [clearState, await startSession(user.id, readCookie(req, SESSION_COOKIE))]);
  } catch (error) {
    console.error("Google OAuth failed", error);
    return redirect("/login?error=google_failed", [clearState]);
  }
}

export default async (req: Request) => {
  const url = new URL(req.url);

  switch (url.pathname) {
    case "/demo-login":
      return demoLogin(req);
    case "/logout":
      return logout(req);
    case "/google-login":
      return googleLogin(url);
    case "/google-callback":
      return googleCallback(req, url);
    default:
      return new Response("Not found", { status: 404 });
  }
};

export const config: Config = {
  path: ["/demo-login", "/logout", "/google-login", "/google-callback"],
};
