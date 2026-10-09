import type { Config } from "@netlify/functions";
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  activityHistory,
  assessmentResults,
  careerAnalysis,
  interviewSessions,
  profiles,
  savedRoadmaps,
} from "../../db/schema.js";
import { analyseProfile, isObject } from "../../lib/career.js";
import { geminiConfigured, geminiJson } from "../../lib/gemini.js";
import {
  getOrCreateDemoUser,
  getSession,
  startSession,
  updateSessionData,
  type Session,
} from "../../lib/session.js";

type Ctx = {
  req: Request;
  url: URL;
  body: any;
  session: Session | null;
};

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(data, { status, headers });

const loginRequired = () => json({ error: "Please log in first.", message: "Please log in first." }, 401);

// =========================================================
// DATA HELPERS
// =========================================================

async function getProfile(userId: number): Promise<Record<string, any>> {
  const [row] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return row?.data || {};
}

async function saveHistory(userId: number, activityType: string, title: string, result: unknown, query = "") {
  await db.insert(activityHistory).values({ userId, activityType, title, query, result });
}

async function getLatestAnalysis(userId: number): Promise<Record<string, any>> {
  const [row] = await db
    .select({ analysis: careerAnalysis.analysis })
    .from(careerAnalysis)
    .where(eq(careerAnalysis.userId, userId))
    .orderBy(desc(careerAnalysis.id))
    .limit(1);
  return isObject(row?.analysis) ? row.analysis : {};
}

async function getLatestAssessment(userId: number): Promise<unknown> {
  const [row] = await db
    .select({ answers: assessmentResults.answers })
    .from(assessmentResults)
    .where(eq(assessmentResults.userId, userId))
    .orderBy(desc(assessmentResults.id))
    .limit(1);
  return row?.answers ?? {};
}

// =========================================================
// PROFILE
// =========================================================

async function profileApi({ session }: Ctx) {
  if (!session) return loginRequired();
  return json(await getProfile(session.userId));
}

async function saveProfile({ req, body, session }: Ctx) {
  const headers: Record<string, string> = {};
  let userId = session?.userId;

  if (!userId) {
    userId = await getOrCreateDemoUser();
    headers["Set-Cookie"] = await startSession(userId);
  }

  if (!isObject(body)) return json({ error: "Invalid profile data." }, 400);

  // Merge partial form updates instead of clearing earlier fields.
  const merged = { ...(await getProfile(userId)), ...body };
  const now = new Date();

  await db
    .insert(profiles)
    .values({ userId, data: merged, updatedAt: now })
    .onConflictDoUpdate({ target: profiles.userId, set: { data: merged, updatedAt: now } });

  await saveHistory(userId, "profile", "Profile updated", { fields_updated: Object.keys(body) });

  return json({ success: true, message: "Profile saved successfully." }, 200, headers);
}

// =========================================================
// ASSESSMENT AND CAREER ANALYSIS
// =========================================================

async function saveAssessment({ body, session }: Ctx) {
  if (!session) return loginRequired();

  const answers = isObject(body) && "answers" in body ? body.answers : body;

  if (typeof answers !== "object" || answers === null) {
    return json({ error: "Invalid assessment answers." }, 400);
  }

  await db.insert(assessmentResults).values({ userId: session.userId, answers });
  await updateSessionData(session, { assessment_answers: answers });
  await saveHistory(session.userId, "assessment", "Career strength assessment completed", { answers });

  return json({ success: true });
}

async function analyzeCareer({ body, session }: Ctx) {
  if (!session) return loginRequired();

  const answers =
    body?.answers ?? session.data.assessment_answers ?? (await getLatestAssessment(session.userId));

  const profile = await getProfile(session.userId);
  const result = await analyseProfile(profile, answers);

  await db.insert(careerAnalysis).values({ userId: session.userId, analysis: result });
  await saveHistory(session.userId, "career_analysis", "Career analysis completed", result);

  return json(result);
}

// =========================================================
// SKILL GAP
// =========================================================

async function skillGapApi({ url, body, session }: Ctx) {
  if (!session) return loginRequired();

  const profile = await getProfile(session.userId);
  const analysis = await getLatestAnalysis(session.userId);

  let selectedCareer: string =
    body?.career || url.searchParams.get("career") || (session.data.selected_career as string) || "";

  if (!selectedCareer && Array.isArray(analysis.careers) && analysis.careers.length) {
    selectedCareer = analysis.careers[0]?.title || "";
  }

  const prompt = `
Create a practical career-specific skill gap analysis.

Profile:
${JSON.stringify(profile)}

Career analysis:
${JSON.stringify(analysis)}

Selected career:
${selectedCareer}

Return JSON with:
{
 "career": "...",
 "readiness_percentage": 0,
 "readiness": "...",
 "strengths": ["..."],
 "gaps": [
   {
     "skill": "...",
     "priority": "High",
     "current_level": "...",
     "target_level": "...",
     "reason": "...",
     "action": "..."
   }
 ],
 "top_priority": "...",
 "top_priority_reason": "..."
}

Use 0-100 for the readiness estimate.
Be honest about missing information.
`;

  let result = await geminiJson(prompt);

  if (!isObject(result)) {
    result = {
      career: selectedCareer || "Career exploration",
      readiness_percentage: 0,
      readiness: "Preliminary estimate unavailable",
      strengths: [],
      gaps: [
        {
          skill: "Career-specific practical experience",
          priority: "High",
          current_level: "Not assessed",
          target_level: "Beginner project completed",
          reason: "Practical experience has not been fully assessed.",
          action: "Build a small project or portfolio item.",
        },
      ],
      top_priority: "Build practical experience",
      top_priority_reason: "A project can help demonstrate your skills.",
      is_fallback: true,
    };
  }

  await saveHistory(session.userId, "skill_gap", "Skill gap analysis", result, selectedCareer);

  return json(result);
}

// =========================================================
// ROADMAP
// =========================================================

async function roadmapApi({ url, body, session }: Ctx) {
  if (!session) return loginRequired();

  const profile = await getProfile(session.userId);
  const analysis = await getLatestAnalysis(session.userId);

  const career: string =
    body?.career || url.searchParams.get("career") || (session.data.selected_career as string) || "";

  let duration = parseInt(body?.duration ?? 30, 10);
  if (![30, 60, 90].includes(duration)) duration = 30;

  const prompt = `
Create a realistic, beginner-friendly career roadmap.

Profile:
${JSON.stringify(profile)}

Analysis:
${JSON.stringify(analysis)}

Selected career: ${career}
Duration: ${duration} days

Do not repeat skills the profile clearly demonstrates.
Do not promise employment.
Prioritise affordable, practical learning activities.

Return JSON:
{
 "career": "...",
 "duration": ${duration},
 "focus": "...",
 "readiness": "...",
 "principle": "...",
 "phases": [
   {
     "title": "...",
     "days": "...",
     "goal": "...",
     "tasks": ["...", "..."],
     "deliverable": "..."
   }
 ]
}
`;

  let result = await geminiJson(prompt);

  if (!isObject(result)) {
    const third = Math.floor(duration / 3);
    const twoThirds = Math.floor((2 * duration) / 3);

    result = {
      career: career || "Career exploration",
      duration,
      focus: "Build career fundamentals",
      readiness: "Not fully assessed",
      principle: "Learn, practise, create, review.",
      phases: [
        {
          title: "Learn the basics",
          days: `Days 1-${Math.max(1, third)}`,
          goal: "Understand the foundations.",
          tasks: [
            "Identify the essential skills for this career.",
            "Choose a beginner-friendly learning resource.",
          ],
          deliverable: "A list of skills and learning goals.",
        },
        {
          title: "Practise",
          days: `Days ${third + 1}-${twoThirds}`,
          goal: "Apply what you learn.",
          tasks: ["Practise relevant tasks regularly.", "Record your progress and questions."],
          deliverable: "Practice work and progress notes.",
        },
        {
          title: "Create and review",
          days: `Days ${twoThirds + 1}-${duration}`,
          goal: "Demonstrate your learning.",
          tasks: [
            "Create one beginner-level project or work sample.",
            "Review your progress and identify the next skill.",
          ],
          deliverable: "A project or portfolio sample.",
        },
      ],
      is_fallback: true,
    };
  }

  await db.insert(savedRoadmaps).values({ userId: session.userId, roadmap: result });
  await saveHistory(session.userId, "roadmap", `${duration}-day career roadmap`, result, career);

  return json(result);
}

// =========================================================
// MOCK INTERVIEW
// =========================================================

async function interviewQuestion({ body, session }: Ctx) {
  if (!session) return loginRequired();

  const career: string = body?.career || (session.data.selected_career as string) || "career exploration";

  let questionIndex = parseInt(body?.question_index ?? 0, 10);
  if (Number.isNaN(questionIndex)) questionIndex = 0;

  const prompt = `
Generate one interview question for a beginner exploring:
${career}

Question number: ${questionIndex + 1}

Adapt to the student's profile:
${JSON.stringify(await getProfile(session.userId))}

Use a suitable mix of career knowledge, problem solving,
communication, and practical situations.
Avoid asking for sensitive personal information.
Do not evaluate appearance, face, accent or video.
Return JSON:
{
 "question": "...",
 "category": "...",
 "purpose": "..."
}
`;

  let result = await geminiJson(prompt);

  if (!isObject(result) || !result.question) {
    const fallbackQuestions = [
      "Tell us about your interest in this career and why you want to explore it.",
      "What skills do you think are important in this field?",
      "Describe a problem you worked on and how you approached it.",
      "How would you learn a skill that is new to you?",
      "What would you do if you were given a task you did not understand?",
    ];

    result = {
      question: fallbackQuestions[Math.abs(questionIndex) % fallbackQuestions.length],
      category: "General",
      purpose: "Explore your reasoning and communication.",
      is_fallback: true,
    };
  }

  await updateSessionData(session, { selected_career: career });

  return json(result);
}

async function evaluateInterview({ body, session }: Ctx) {
  if (!session) return loginRequired();

  const career: string = body?.career || (session.data.selected_career as string) || "career exploration";
  const question = String(body?.question ?? "").trim();
  const answer = String(body?.answer ?? "").trim();

  if (!answer) return json({ error: "Please enter an answer first." }, 400);

  const prompt = `
Evaluate this mock interview answer fairly and constructively.

Career: ${career}
Question: ${question}
Answer: ${answer}

Evaluate text content only:
- relevance
- clarity of reasoning
- communication
- career knowledge, where applicable

Do not evaluate face, appearance, accent, age, gender or background.
Do not assume that a short answer means low ability.
Give specific and actionable feedback.
This is practice feedback, not a hiring decision.

Return JSON:
{
 "overall_score": 0,
 "communication_score": 0,
 "relevance_score": 0,
 "problem_solving_score": 0,
 "career_knowledge_score": 0,
 "strengths": ["..."],
 "improvements": ["..."],
 "feedback": "...",
 "sample_improved_answer": "..."
}

Scores must be integers from 0 to 100.
`;

  let result = await geminiJson(prompt);

  if (!isObject(result)) {
    result = {
      overall_score: 0,
      communication_score: 0,
      relevance_score: 0,
      problem_solving_score: 0,
      career_knowledge_score: 0,
      strengths: [],
      improvements: ["Try giving a specific example.", "Explain your reasoning step by step."],
      feedback: "AI feedback is unavailable right now. Please try again in a moment.",
      sample_improved_answer: "",
      is_fallback: true,
    };
  }

  await saveHistory(session.userId, "interview_answer", "Mock interview answer evaluated", result, career);

  return json(result);
}

// =========================================================
// REPORT, HISTORY AND HEALTH
// =========================================================

async function reportApi({ session }: Ctx) {
  if (!session) return loginRequired();

  const [interviewRow] = await db
    .select({ feedback: interviewSessions.feedback })
    .from(interviewSessions)
    .where(eq(interviewSessions.userId, session.userId))
    .orderBy(desc(interviewSessions.id))
    .limit(1);

  return json({
    profile: await getProfile(session.userId),
    analysis: await getLatestAnalysis(session.userId),
    interview_feedback: interviewRow?.feedback ?? {},
  });
}

async function historyApi({ session }: Ctx) {
  if (!session) return loginRequired();

  const rows = await db
    .select()
    .from(activityHistory)
    .where(eq(activityHistory.userId, session.userId))
    .orderBy(desc(activityHistory.id))
    .limit(50);

  return json({
    history: rows.map((row) => ({
      id: row.id,
      activity_type: row.activityType,
      title: row.title,
      query: row.query,
      result: row.result ?? {},
      created_at: row.createdAt.toISOString(),
    })),
  });
}

async function health() {
  return json({
    status: "ok",
    app: "CareerNova AI",
    gemini_configured: geminiConfigured(),
    google_login_configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  });
}

// =========================================================
// ROUTER
// =========================================================

type Handler = (ctx: Ctx) => Promise<Response>;

const routes: Record<string, { methods: string[]; handler: Handler }> = {
  "/api/profile": { methods: ["GET"], handler: profileApi },
  "/api/profile/save": { methods: ["POST"], handler: saveProfile },
  "/api/assessment/save": { methods: ["POST"], handler: saveAssessment },
  "/api/analyze-career": { methods: ["POST"], handler: analyzeCareer },
  "/api/skill-gap": { methods: ["GET", "POST"], handler: skillGapApi },
  "/api/roadmap": { methods: ["GET", "POST"], handler: roadmapApi },
  "/api/interview/question": { methods: ["GET", "POST"], handler: interviewQuestion },
  "/api/interview/evaluate": { methods: ["POST"], handler: evaluateInterview },
  "/api/report": { methods: ["GET"], handler: reportApi },
  "/api/history": { methods: ["GET"], handler: historyApi },
  "/api/health": { methods: ["GET"], handler: health },
};

export default async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  const route = routes[path];

  if (!route) {
    return json({ error: "Page not found.", message: "Check the URL and try again." }, 404);
  }

  if (!route.methods.includes(req.method)) {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    let body: any = {};
    if (req.method === "POST") {
      try {
        body = (await req.json()) ?? {};
      } catch {
        body = {};
      }
    }

    const session = await getSession(req);
    return await route.handler({ req, url, body, session });
  } catch (error) {
    console.error("Internal server error", error);
    return json(
      { error: "An internal server error occurred.", message: "An internal server error occurred." },
      500,
    );
  }
};

export const config: Config = {
  path: "/api/*",
};
