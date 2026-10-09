import { randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "../db/index.js";
import { sessions, users } from "../db/schema.js";

export const SESSION_COOKIE = "cl_session";
const SESSION_DAYS = 30;

export type Session = {
  id: string;
  userId: number;
  data: Record<string, unknown>;
};

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function cookieHeader(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export async function getSession(req: Request): Promise<Session | null> {
  const id = readCookie(req, SESSION_COOKIE);
  if (!id) return null;

  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return row ? { id: row.id, userId: row.userId, data: row.data || {} } : null;
}

// Equivalent of Flask's session.clear() followed by setting a new user.
export async function startSession(userId: number, previous?: string | null): Promise<string> {
  if (previous) await db.delete(sessions).where(eq(sessions.id, previous));

  const id = randomBytes(32).toString("hex");
  await db.insert(sessions).values({
    id,
    userId,
    data: {},
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86400 * 1000),
  });

  return cookieHeader(SESSION_COOKIE, id, SESSION_DAYS * 86400);
}

export async function endSession(req: Request): Promise<string> {
  const id = readCookie(req, SESSION_COOKIE);
  if (id) await db.delete(sessions).where(eq(sessions.id, id));
  return cookieHeader(SESSION_COOKIE, "", 0);
}

export async function updateSessionData(session: Session, patch: Record<string, unknown>) {
  session.data = { ...session.data, ...patch };
  await db.update(sessions).set({ data: session.data }).where(eq(sessions.id, session.id));
}

export const DEMO_EMAIL = "demo@careernova.local";
export const DEMO_NAME = "CareerNova Demo User";

export async function getOrCreateDemoUser(): Promise<number> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(users)
    .values({ name: DEMO_NAME, email: DEMO_EMAIL })
    .returning({ id: users.id });
  return created.id;
}
