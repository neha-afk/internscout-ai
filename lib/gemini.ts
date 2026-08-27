const model = "gemini-3.6-flash";

// Startup diagnostic only: never log the key itself. Requests still read the
// environment fresh in readApiKey() below.
const startupApiKey = process.env.GEMINI_API_KEY?.trim();
console.log("Gemini key loaded at startup:", {
  exists: Boolean(startupApiKey),
  length: startupApiKey?.length ?? 0,
  suffix: startupApiKey?.slice(-4) ?? "",
});

function readApiKey(): string {
  const rawKey = process.env.GEMINI_API_KEY;
  const key = rawKey?.trim();
  console.log("Gemini key diagnostic:", {
    exists: Boolean(rawKey),
    length: key?.length ?? 0,
    prefix: key?.slice(0, 4) ?? "",
    suffix: key?.slice(-4) ?? "",
  });
  if (!key) throw new Error("GEMINI_API_KEY is missing.");
  return key;
}

export async function generateGeminiText(
  prompt: string,
  options?: { responseMimeType?: string }
): Promise<string> {
  const apiKey = readApiKey();
  const generationConfig = {
    temperature: 0.2,
    ...(options?.responseMimeType ? { responseMimeType: options.responseMimeType } : {}),
  };
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    console.error("Gemini HTTP request failed:", response.status);
    console.error("Gemini API error:", response.status, errorText);
    const safeDetails = errorText.replace(/\s+/g, " ").slice(0, 500);
    throw new Error(`Gemini request failed with status ${response.status}: ${safeDetails}`);
  }
  console.log("Gemini HTTP request succeeded", response.status);
  const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  console.log("Gemini candidates present:", Array.isArray(payload.candidates) && payload.candidates.length > 0);
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) throw new Error("Gemini returned no content.");
  console.log("Gemini text extracted successfully", { length: text.length });
  return text;
}

export async function generateGeminiJson<T>(prompt: string): Promise<T> {
  const text = await generateGeminiText(
    `${prompt}\nReturn JSON only. Do not use markdown fences.`,
    { responseMimeType: "application/json" }
  );
  try {
    const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const firstBrace = unfenced.search(/[\[{]/);
    const lastBrace = Math.max(unfenced.lastIndexOf("}"), unfenced.lastIndexOf("]"));
    const candidate = firstBrace >= 0 && lastBrace > firstBrace
      ? unfenced.slice(firstBrace, lastBrace + 1)
      : unfenced;
    const parsed = JSON.parse(candidate) as T;
    console.log("Gemini JSON parsed successfully");
    return parsed;
  } catch (error) {
    console.error("Gemini JSON parsing failed:", error);
    throw new Error("Gemini returned invalid JSON.");
  }
}

export function sanitizeResumeText(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email removed]")
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, "[phone removed]")
    .replace(/\b(?:street|st\.|road|rd\.|avenue|ave\.|lane|ln\.)\s+[^\n,]+/gi, "[address removed]")
    .slice(0, 18000);
}
