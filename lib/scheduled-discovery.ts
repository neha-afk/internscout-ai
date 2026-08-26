import { Firecrawl } from "firecrawl";
import {
  expireStaleInternships,
  getExistingSourceUrls,
  upsertInternship,
} from "@/lib/internships";
import { detectJobAlertMatches } from "@/lib/job-alerts";
import {
  DISCOVERY_QUERIES,
  MAX_NEW_OPPORTUNITIES_PER_RUN,
  SEARCH_RESULT_LIMIT,
} from "@/lib/discovery-queries";
import type { InternshipInsert } from "@/types/internship";

type DiscoveryResult = { url?: unknown; title?: unknown; description?: unknown };
type ScrapedOpportunity = { url: string; title: string; content: string };

const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });

function normalizedUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

function clean(value: string, maxLength = 800): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[`*_>#]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function domain(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function extractOpportunity(candidate: ScrapedOpportunity): InternshipInsert {
  const title = clean(candidate.title, 240);
  const companyRole = title.split(" - ");
  const content = clean(candidate.content);
  const location = content.match(/(?:location|based in|勤務地)\s*[:\-]\s*([^\n.]+)/i)?.[1]?.trim() ?? null;
  const workMode = /\bremote\b/i.test(`${title} ${content}`)
    ? "remote"
    : /\bhybrid\b/i.test(`${title} ${content}`)
      ? "hybrid"
      : /\bon[- ]?site\b/i.test(`${title} ${content}`)
        ? "onsite"
        : null;
  const skills = [...new Set((content.match(/\b(?:Python|JavaScript|TypeScript|React|Node\.js|SQL|AWS|Docker|Machine Learning|TensorFlow|PyTorch)\b/gi) ?? []).map((skill) => skill.trim()))];
  return {
    company: companyRole.length > 1 ? companyRole[0].trim() : null,
    role: companyRole.length > 1 ? companyRole.slice(1).join(" - ").trim() : title || null,
    description: content || null,
    location,
    workMode,
    postedDate: null,
    deadline: null,
    duration: content.match(/\b\d+\s*(?:-\s*\d+)?\s*months?\b/i)?.[0] ?? null,
    stipend: null,
    experienceRequired: null,
    graduationRequirements: null,
    requiredSkills: skills,
    applicationUrl: candidate.url,
    sourceUrl: candidate.url,
    sourceDomain: domain(candidate.url),
    status: "active",
    verificationStatus: "needs_review",
    verificationScore: 50,
    verificationReasons: ["Discovered by the scheduled internship pipeline; review is pending."],
    lastVerifiedAt: new Date().toISOString(),
  };
}

export async function runScheduledDiscovery() {
  const searchResults = await Promise.all(
    DISCOVERY_QUERIES.map(async (query) => {
      try {
        const response = await firecrawl.search(query, { limit: SEARCH_RESULT_LIMIT });
        return response.web ?? [];
      } catch {
        return [];
      }
    })
  );
  const discovered = new Map<string, ScrapedOpportunity>();
  let duplicateUrlsSkipped = 0;
  for (const results of searchResults) {
    for (const result of results as DiscoveryResult[]) {
      if (typeof result.url !== "string") continue;
      const url = normalizedUrl(result.url);
      if (discovered.has(url)) {
        duplicateUrlsSkipped += 1;
        continue;
      }
      discovered.set(url, { url: result.url, title: typeof result.title === "string" ? result.title : "Internship opportunity", content: typeof result.description === "string" ? result.description : "" });
    }
  }
  const urls = [...discovered.keys()];
  const existingUrls = await getExistingSourceUrls(urls);
  const newCandidates = [...discovered.entries()].filter(([url]) => !existingUrls.has(url)).slice(0, MAX_NEW_OPPORTUNITIES_PER_RUN);
  const scraped = await Promise.allSettled(newCandidates.map(async ([, candidate]) => {
    const page = await firecrawl.scrape(candidate.url, { formats: ["markdown"], onlyMainContent: true });
    const content = typeof page.markdown === "string" ? page.markdown : typeof page.html === "string" ? page.html : "";
    return extractOpportunity({ ...candidate, content });
  }));
  let internshipsPersisted = 0;
  let internshipsRejected = 0;
  for (const result of scraped) {
    if (result.status !== "fulfilled" || !result.value.role) {
      internshipsRejected += 1;
      continue;
    }
    try {
      await upsertInternship(result.value);
      internshipsPersisted += 1;
    } catch {
      internshipsRejected += 1;
    }
  }
  const expiredInternshipsUpdated = await expireStaleInternships();
  const alertSummary = await detectJobAlertMatches();
  return {
    queriesProcessed: DISCOVERY_QUERIES.length,
    urlsDiscovered: discovered.size,
    duplicateUrlsSkipped,
    existingUrlsSkipped: existingUrls.size,
    newOpportunitiesAnalyzed: newCandidates.length,
    internshipsPersisted,
    internshipsRejected,
    expiredInternshipsUpdated,
    ...alertSummary,
  };
}
