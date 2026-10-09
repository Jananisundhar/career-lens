import { GoogleGenAI } from "@google/genai";

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

// Calls Gemini through Netlify AI Gateway (credentials are injected at runtime).
// Returns null on any failure so callers can use their fallback content.
export async function geminiJson(prompt: string): Promise<any> {
  if (!geminiConfigured()) return null;

  try {
    const ai = new GoogleGenAI({});
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents:
        prompt +
        `

Return only valid JSON.
Do not use Markdown code fences.
Do not add explanations outside the JSON object.
`,
      config: { responseMimeType: "application/json" },
    });

    let text = (response.text || "").trim();

    if (text.startsWith("```")) {
      const lines = text.split("\n");
      if (lines[0]?.startsWith("```")) lines.shift();
      if (lines.at(-1)?.trim() === "```") lines.pop();
      text = lines.join("\n");
    }

    return JSON.parse(text);
  } catch (error) {
    console.error("Gemini request failed:", error);
    return null;
  }
}
