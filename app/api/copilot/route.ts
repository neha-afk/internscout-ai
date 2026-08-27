import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createPersistenceClient } from "@/lib/internships";
import { copilotTypes, generateCopilotContent, type CopilotType } from "@/lib/application-copilot";
import type { Internship, ResumeMatchResult } from "@/types/internship";
import { generateGeminiText, sanitizeResumeText } from "@/lib/gemini";

export async function POST(request: Request) {
  const auth = await createServerClient();
  const { data: authData } = await auth.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => null) as { internshipId?: string; outputType?: string } | null;
  if (!body?.internshipId || !body.outputType || !copilotTypes.includes(body.outputType as CopilotType)) return NextResponse.json({ error: "internshipId and a valid outputType are required." }, { status: 400 });
  const client = createPersistenceClient();
  const [{ data: saved }, { data: resume }, { data: internship }] = await Promise.all([
    client.from("saved_internships").select("internship_id").eq("user_id", authData.user.id).eq("internship_id", body.internshipId).maybeSingle(),
    client.from("user_resumes").select("id, extracted_text").eq("user_id", authData.user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("internships").select("*").eq("id", body.internshipId).maybeSingle(),
  ]);
  if (!saved || !resume || !internship) return NextResponse.json({ error: !resume ? "Upload a resume before using Application Copilot." : "Saved internship not found." }, { status: 404 });
  const { data: previous } = await client.from("resume_analyses").select("result").eq("user_id", authData.user.id).eq("resume_id", resume.id).eq("internship_id", body.internshipId).maybeSingle();
  const { data: cachedOutput } = await client.from("application_copilot_outputs").select("content").eq("user_id", authData.user.id).eq("resume_id", resume.id).eq("internship_id", body.internshipId).eq("output_type", body.outputType).maybeSingle();
  if (cachedOutput?.content) return NextResponse.json({ outputType: body.outputType, content: cachedOutput.content, cached: true });
  const analysis = previous?.result as ResumeMatchResult | null;
  let content = generateCopilotContent(body.outputType as CopilotType, internship as Internship, { text: resume.extracted_text ?? "", analysis });
  if (process.env.GEMINI_API_KEY) {
    try {
      content = await generateGeminiText(`Write the requested application content for this internship. Use only facts in the resume and internship; never invent achievements, skills, projects, or experience. Output type: ${body.outputType}\nINTERNSHIP:\n${JSON.stringify(internship)}\nMATCH ANALYSIS:\n${JSON.stringify(analysis)}\nSANITIZED RESUME:\n${sanitizeResumeText(resume.extracted_text ?? "")}`);
    } catch (error) {
      console.error("Gemini Copilot generation failed:", error);
    }
  }
  await client.from("application_copilot_outputs").upsert({ user_id: authData.user.id, internship_id: body.internshipId, resume_id: resume.id, output_type: body.outputType, content }, { onConflict: "user_id,internship_id,resume_id,output_type" });
  return NextResponse.json({ outputType: body.outputType, content });
}
