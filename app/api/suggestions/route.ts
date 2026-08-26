import { NextResponse } from "next/server";
import { createPersistenceClient } from "@/lib/internships";
import {
  fallbackSuggestions,
  type SuggestionType,
} from "@/lib/suggestion-options";

const validTypes = ["roles", "skills", "locations"] as const;
type TextSuggestionRow = { role?: unknown; location?: unknown };

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function normalizeSuggestion(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function mergeSuggestions(
  dynamicValues: string[],
  fallbackValues: string[],
  query: string,
  limit: number
): string[] {
  const normalizedQuery = query.trim().toLowerCase();
  const merged = new Map<string, { value: string; dynamic: boolean; index: number }>();
  for (const [index, value] of dynamicValues.entries()) {
    const trimmed = value.trim();
    const key = normalizeSuggestion(trimmed);
    if (trimmed && (!normalizedQuery || key.includes(normalizedQuery))) {
      merged.set(key, { value: trimmed, dynamic: true, index });
    }
  }
  for (const [index, value] of fallbackValues.entries()) {
    const trimmed = value.trim();
    const key = normalizeSuggestion(trimmed);
    if (trimmed && (!normalizedQuery || key.includes(normalizedQuery)) && !merged.has(key)) {
      merged.set(key, { value: trimmed, dynamic: false, index });
    }
  }
  return [...merged.values()]
    .sort((left, right) => {
      const relevance = (value: string) => {
        if (!normalizedQuery) return 0;
        const normalized = normalizeSuggestion(value);
        return normalized === normalizedQuery
          ? 0
          : normalized.startsWith(normalizedQuery)
            ? 1
            : 2;
      };
      return (
        relevance(left.value) - relevance(right.value) ||
        Number(right.dynamic) - Number(left.dynamic) ||
        left.index - right.index
      );
    })
    .slice(0, limit)
    .map((item) => item.value);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedType = url.searchParams.get("type");
  const type = validTypes.find((item) => item === requestedType) as SuggestionType | undefined;
  if (!type) return NextResponse.json({ error: "Invalid suggestion type." }, { status: 400 });
  const query = url.searchParams.get("q") ?? "";
  const parsedLimit = Number(url.searchParams.get("limit") ?? "8");
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.floor(parsedLimit), 1), 8) : 8;
  const supabase = createPersistenceClient();

  if (type === "skills") {
    const { data, error } = await supabase.from("internships").select("required_skills").eq("status", "active").limit(200);
    if (error) return NextResponse.json({ suggestions: [] }, { status: 200 });
    const values = (data ?? []).flatMap((row) => Array.isArray(row.required_skills) ? row.required_skills.filter((item): item is string => typeof item === "string") : []);
    const dynamicValues = query.trim() ? values : values.slice(0, Math.floor(limit / 2));
    return NextResponse.json({
      suggestions: mergeSuggestions(
        dynamicValues,
        fallbackSuggestions[type],
        query,
        limit
      ),
    });
  }

  const column = type === "roles" ? "role" : "location";
  let databaseQuery = supabase.from("internships").select(column).eq("status", "active").not(column, "is", null).limit(200);
  if (query.trim()) databaseQuery = databaseQuery.ilike(column, `%${escapeLike(query.trim())}%`);
  const { data, error } = await databaseQuery;
  if (error) return NextResponse.json({ suggestions: [] }, { status: 200 });
  const rows = (data ?? []) as TextSuggestionRow[];
  const values = rows.map((row) => row[column as "role" | "location"]).filter((item): item is string => typeof item === "string");
  const dynamicValues = query.trim() ? values : values.slice(0, Math.floor(limit / 2));
  return NextResponse.json({
    suggestions: mergeSuggestions(
      dynamicValues,
      fallbackSuggestions[type],
      query,
      limit
    ),
  });
}
