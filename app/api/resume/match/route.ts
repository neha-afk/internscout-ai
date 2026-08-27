import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createPersistenceClient } from "@/lib/internships";
import { analyzeResumeMatch } from "@/lib/resume-match";
import { generateGeminiJson, sanitizeResumeText } from "@/lib/gemini";
import type { Internship } from "@/types/internship";

export async function POST(request: Request) {
  const auth = await createServerClient();
  const { data: authData } = await auth.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => null) as { resumeId?: string; internshipId?: string } | null;
  if (!body?.resumeId || !body.internshipId) return NextResponse.json({ error: "resumeId and internshipId are required." }, { status: 400 });
  const client = createPersistenceClient();
  const [{ data: resume }, { data: internship }] = await Promise.all([
    client.from("user_resumes").select("id, extracted_text").eq("id", body.resumeId).eq("user_id", authData.user.id).maybeSingle(),
    client.from("internships").select("*").eq("id", body.internshipId).maybeSingle(),
  ]);
  if (!resume || !internship) return NextResponse.json({ error: "Resume or internship not found." }, { status: 404 });
  const deterministic = analyzeResumeMatch(resume.extracted_text ?? "", internship as Internship);
  const { data: previous } = await client.from("resume_analyses").select("result").eq("user_id", authData.user.id).eq("resume_id", body.resumeId).eq("internship_id", body.internshipId).maybeSingle();
  const cached = previous?.result as (typeof deterministic & { geminiEnhanced?: boolean }) | null;
  if (cached?.geminiEnhanced) return NextResponse.json(cached);
  let result: typeof deterministic & { geminiEnhanced?: boolean } = deterministic;
  if (process.env.GEMINI_API_KEY) {
    try {
      const ai = await generateGeminiJson<Partial<typeof deterministic>>(`Analyze this internship against the sanitized resume. Never invent facts. Only report skills, projects, experience, and qualifications supported by the supplied text.\nINTERNSHIP:\n${JSON.stringify(internship)}\nDETERMINISTIC ANALYSIS:\n${JSON.stringify(deterministic)}\nRESUME:\n${sanitizeResumeText(resume.extracted_text ?? "")}`);
      result = { ...deterministic, ...ai, matchScore: Math.max(0, Math.min(100, Number(ai.matchScore) || deterministic.matchScore)), geminiEnhanced: true };
    } catch (error) {
      console.error("Gemini resume analysis failed:", error);
    }
  }
  await client.from("resume_analyses").upsert({ user_id: authData.user.id, resume_id: body.resumeId, internship_id: body.internshipId, result }, { onConflict: "user_id,resume_id,internship_id" });
  return NextResponse.json(result);
}
