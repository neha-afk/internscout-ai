import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createPersistenceClient } from "@/lib/internships";

export async function POST(request: Request) {
  const auth = await createServerClient();
  const { data } = await auth.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.type !== "application/pdf" || file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "Upload a PDF resume up to 5 MB." }, { status: 400 });
  // Content-Type and extensions can be spoofed; PDF magic bytes verify the actual format.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdfMagic = [0x25, 0x50, 0x44, 0x46, 0x2d];
  if (bytes.length < pdfMagic.length || !pdfMagic.every((byte, index) => bytes[index] === byte)) {
    return NextResponse.json({ error: "The uploaded file is not a valid PDF." }, { status: 400 });
  }
  const resumeId = crypto.randomUUID();
  const path = `${data.user.id}/${resumeId}.pdf`;
  const client = createPersistenceClient();
  const upload = await client.storage.from("resumes").upload(path, file, { contentType: "application/pdf", upsert: true });
  if (upload.error) {
    console.error("Resume upload storage error:", {
      message: upload.error.message,
      code: upload.error.name,
      details: upload.error,
    });
    return NextResponse.json({ error: "Unable to store resume." }, { status: 500 });
  }
  const raw = new TextDecoder("latin1").decode(bytes);
  const extractedText = [...raw.matchAll(/\(([^()]*)\)/g)]
    .map((match) => match[1])
    .join(" ")
    .replace(/\\[nrt]/g, " ")
    .replace(/\u0000/g, "")
    .trim();
  const { data: resume, error } = await client.from("user_resumes").insert({ id: resumeId, user_id: data.user.id, file_name: file.name, storage_path: path, extracted_text: extractedText }).select("id, file_name, created_at").single();
  if (error) {
    console.error("Resume metadata insert error:", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
    await client.storage.from("resumes").remove([path]);
    return NextResponse.json({ error: "Unable to save resume metadata." }, { status: 500 });
  }
  return NextResponse.json({ resume });
}
