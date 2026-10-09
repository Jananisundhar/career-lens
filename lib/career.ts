import { geminiJson } from "./gemini.js";

type Profile = Record<string, any>;

// A transparent fallback for development. This is not a real AI assessment.
export function buildFallbackAnalysis(profile: Profile) {
  const interestText = [
    profile.interests ?? "",
    profile.career_interest ?? "",
    profile.career_areas ?? "",
    profile.department ?? "",
  ]
    .map(String)
    .join(" ")
    .toLowerCase();

  let careers = [
    {
      title: "Software Developer",
      fit_percentage: 70,
      reason: "Explore programming, application development and problem solving.",
      skills: ["Programming", "Problem solving", "Version control"],
      pathway: "Build programming fundamentals and small projects.",
    },
    {
      title: "Data Analyst",
      fit_percentage: 68,
      reason: "Explore working with data, spreadsheets and analytical questions.",
      skills: ["Excel", "SQL", "Data interpretation"],
      pathway: "Practise data analysis with beginner-friendly datasets.",
    },
    {
      title: "Digital Marketing Specialist",
      fit_percentage: 65,
      reason: "Explore communication, content, research and digital platforms.",
      skills: ["Communication", "Content planning", "Analytics"],
      pathway: "Create a small content campaign and review its performance.",
    },
    {
      title: "Business Analyst",
      fit_percentage: 64,
      reason: "Explore business problems, research and structured communication.",
      skills: ["Research", "Documentation", "Analytical thinking"],
      pathway: "Practise writing problem statements and process documents.",
    },
    {
      title: "Graphic Designer",
      fit_percentage: 62,
      reason: "Explore visual communication and creative problem solving.",
      skills: ["Visual design", "Typography", "Design tools"],
      pathway: "Create a small portfolio of original designs.",
    },
    {
      title: "Banking and Finance Associate",
      fit_percentage: 60,
      reason: "Explore financial services, accuracy and numerical reasoning.",
      skills: ["Numerical reasoning", "Excel", "Financial literacy"],
      pathway: "Study financial basics and practise relevant aptitude questions.",
    },
    {
      title: "Government Exam Candidate",
      fit_percentage: 60,
      reason: "Explore public-sector opportunities and their eligibility requirements.",
      skills: ["General knowledge", "Reasoning", "Language skills"],
      pathway: "Identify a suitable examination and check its official eligibility criteria.",
    },
    {
      title: "Teacher or Education Professional",
      fit_percentage: 58,
      reason: "Explore teaching, learning support and educational communication.",
      skills: ["Communication", "Subject knowledge", "Planning"],
      pathway: "Research the qualifications required for your chosen teaching role.",
    },
    {
      title: "Legal Research Assistant",
      fit_percentage: 58,
      reason: "Explore legal research, reading and structured writing.",
      skills: ["Research", "Writing", "Critical thinking"],
      pathway: "Learn about legal careers and their education requirements.",
    },
    {
      title: "Human Resources Associate",
      fit_percentage: 57,
      reason: "Explore people-focused work, communication and administration.",
      skills: ["Communication", "Organisation", "Documentation"],
      pathway: "Learn basic HR processes and workplace communication.",
    },
  ];

  const promote = (title: string) => {
    careers = [...careers.filter((c) => c.title === title), ...careers.filter((c) => c.title !== title)];
  };

  if (interestText.includes("design") || interestText.includes("creative")) promote("Graphic Designer");
  else if (interestText.includes("law") || interestText.includes("legal")) promote("Legal Research Assistant");
  else if (interestText.includes("bank") || interestText.includes("finance")) promote("Banking and Finance Associate");
  else if (interestText.includes("government")) promote("Government Exam Candidate");

  return {
    profile_summary:
      "This is a preliminary development-mode career overview. " +
      "AI analysis is currently unavailable, so complete the assessment " +
      "and try again for a personalised result.",
    readiness_score: 0,
    readiness_dimensions: {
      education: 0,
      skills: 0,
      projects: 0,
      assessment: 0,
      interview: 0,
      roadmap: 0,
    },
    strengths: ["Your profile has been collected.", "You can explore multiple career pathways."],
    skill_gaps: [
      {
        skill: "Career-specific practical experience",
        priority: "High",
        reason: "Practical work helps you demonstrate your abilities.",
        action: "Complete a small project related to a career you want to explore.",
      },
    ],
    careers,
    next_step: "Complete your assessment and add your current skills and projects.",
    is_fallback: true,
  };
}

export async function analyseProfile(profile: Profile, assessmentAnswers: unknown) {
  const prompt = `
You are CareerNova AI, a career guidance assistant.

Analyse the following student's information:
${JSON.stringify(profile)}

Assessment answers:
${JSON.stringify(assessmentAnswers)}

Consider careers across all relevant fields, including:
technology, finance, banking, law, government, education,
design, creative work, marketing, media, HR, administration,
business, science, research, healthcare-related careers,
hospitality, travel, journalism, entrepreneurship,
agriculture, environmental work and emerging careers.

Do not recommend only technology careers.
Do not invent qualifications, exam eligibility or employment guarantees.
Mention when a qualification or licensing requirement needs verification.
Treat fit percentages as estimates, not probabilities of employment.
Do not assume the student already knows a skill unless their profile says so.
Give practical beginner-friendly next steps.

Return a JSON object with:
{
  "profile_summary": "short personalised summary",
  "readiness_score": 0,
  "readiness_dimensions": {
    "education": 0,
    "skills": 0,
    "projects": 0,
    "assessment": 0,
    "interview": 0,
    "roadmap": 0
  },
  "strengths": ["..."],
  "skill_gaps": [
    {
      "skill": "...",
      "priority": "High",
      "reason": "...",
      "action": "..."
    }
  ],
  "careers": [
    {
      "title": "...",
      "fit_percentage": 70,
      "reason": "...",
      "skills": ["..."],
      "pathway": "..."
    }
  ],
  "next_step": "..."
}

Return 5 to 8 career options.
Scores must be integers from 0 to 100.
`;

  let result = await geminiJson(prompt);

  if (!isObject(result) || !Array.isArray(result.careers)) {
    result = buildFallbackAnalysis(profile);
  }

  result.is_fallback ??= false;
  result.careers = (result.careers || []).slice(0, 8);

  return result;
}

export function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
