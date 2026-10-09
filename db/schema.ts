import { pgTable, serial, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial().primaryKey(),
  googleId: text("google_id").unique(),
  name: text(),
  email: text(),
  profilePhoto: text("profile_photo"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Server-side sessions; the browser only holds the random session id.
export const sessions = pgTable("sessions", {
  id: text().primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  data: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const profiles = pgTable("profiles", {
  id: serial().primaryKey(),
  userId: integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  data: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const activityHistory = pgTable("activity_history", {
  id: serial().primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  activityType: text("activity_type"),
  title: text(),
  query: text(),
  result: jsonb(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("activity_history_user_idx").on(t.userId)]);

export const careerAnalysis = pgTable("career_analysis", {
  id: serial().primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  analysis: jsonb(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("career_analysis_user_idx").on(t.userId)]);

export const interviewSessions = pgTable("interview_sessions", {
  id: serial().primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  career: text(),
  questions: jsonb(),
  answers: jsonb(),
  feedback: jsonb(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const assessmentResults = pgTable("assessment_results", {
  id: serial().primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  answers: jsonb(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const savedRoadmaps = pgTable("saved_roadmaps", {
  id: serial().primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  roadmap: jsonb(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
