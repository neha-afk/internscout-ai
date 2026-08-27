import { Firecrawl } from "firecrawl";
import { NextResponse } from "next/server";
import {
  getCachedInternships,
  type CachedInternshipRow,
  createPersistenceClient,
  upsertInternship,
} from "@/lib/internships";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type {
  ExperienceRange,
  InternshipInsert,
  SearchFilters,
  WorkMode,
} from "@/types/internship";

const validWorkModes: WorkMode[] = ["remote", "hybrid", "onsite"];

const validExperienceRanges: ExperienceRange[] = [
  "0",
  "0-1",
  "1-2",
  "2+",
];

const firecrawl = new Firecrawl({
  apiKey: process.env.FIRECRAWL_API_KEY!,
});

const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_ROUTE = "/api/search";

type SearchWebResult = {
  url: string;
  [key: string]: unknown;
};

function getRequestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

function hasUrl(value: unknown): value is SearchWebResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "url" in value &&
    typeof value.url === "string"
  );
}

const blockedDomains = [
  "reddit.com",
  "instagram.com",
  "youtube.com",
  "facebook.com",
  "x.com",
  "twitter.com",
];

// Aggregator/search domains are intentionally excluded from internship
// candidates so they cannot consume scrape budget or persistence work.
const aggregatorDomains = [
  "glassdoor.com",
  "glassdoor.co.in",
  "linkedin.com",
  "indeed.com",
  "naukri.com",
  "internshala.com",
  "ziprecruiter.com",
  "simplyhired.com",
  "monster.com",
];

const atsDomains = [
  "jobs.lever.co",
  "boards.greenhouse.io",
  "greenhouse.io",
  "ashbyhq.com",
  "workdayjobs.com",
];

const jobBoardDomains = [
  "linkedin.com",
  "indeed.com",
  "internshala.com",
  "wellfound.com",
  "remoterocketship.com",
];

function domainMatches(domain: string, candidate: string): boolean {
  return domain === candidate || domain.endsWith(`.${candidate}`);
}

function sourcePriority(url: string): number {
  let domain = "";
  let pathname = "";

  try {
    const parsedUrl = new URL(url);
    domain = parsedUrl.hostname.toLowerCase();
    pathname = parsedUrl.pathname.toLowerCase();
  } catch {
    return 0;
  }

  if (atsDomains.some((candidate) => domainMatches(domain, candidate))) {
    return 100;
  }

  if (jobBoardDomains.some((candidate) => domainMatches(domain, candidate))) {
    return 60;
  }

  if (domainMatches(domain, "github.com")) {
    return 30;
  }

  if (/\/(careers?|jobs?)(\/|$)/i.test(pathname) || /careers?|jobs?/i.test(domain)) {
    return 90;
  }

  return 70;
}

function resultDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return url;
  }
}

function isAggregatorOrListingUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    if (aggregatorDomains.some((candidate) => domainMatches(domain, candidate))) {
      return true;
    }
    // Search/listing pages are not individual opportunities. Handle common
    // path markers (including Glassdoor's SRCH_ URLs) and pagination/query
    // markers without rejecting normal posting URLs.
    if (pathname.includes("srch_") || /\/(?:search|search-results|listing|listings)(?:\/|$)/i.test(pathname)) {
      return true;
    }
    if (/\/jobs?\/?$/i.test(pathname) && parsed.search) return true;
    for (const key of parsed.searchParams.keys()) {
      if (/^(?:q|query|keywords|page|pages|start|offset|from|to)$/i.test(key)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

export function normalizeResultUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.protocol = "https:";
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|ref|source|tracking|fbclid|gclid)/i.test(key)) parsed.searchParams.delete(key);
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString();
  } catch {
    return url.trim().replace(/\/+$/, "");
  }
}

function normalizedOpportunityRole(result: SearchWebResult): string {
  return `${String(result.company ?? "")} ${String(result.title ?? "")}`
    .toLowerCase()
    .replace(/\b(internship|intern)\b/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function applyDomainCap(results: SearchWebResult[]): SearchWebResult[] {
  const cap = Math.min(3, Math.max(1, Math.floor(results.length * 0.4)));
  const counts = new Map<string, number>();
  const primary: SearchWebResult[] = [];
  for (const result of results) {
    const domain = resultDomain(result.url);
    const count = counts.get(domain) ?? 0;
    if (primary.length < 10 && count < cap) {
      primary.push({ ...result, domainRankPenaltyApplied: count > 0 });
      counts.set(domain, count + 1);
    }
  }
  // Keep the cap strict for the surfaced set. If there are not enough
  // alternate domains to fill ten slots, the overflow remains intentionally
  // unsurfaced rather than allowing one ATS to consume the visible set.
  return primary;
}

export function deprioritizePreviouslyShown<T>(results: T[]): T[] {
  return [...results].sort((left, right) => {
    const leftSeen = Boolean((left as { is_previously_seen?: boolean }).is_previously_seen);
    const rightSeen = Boolean((right as { is_previously_seen?: boolean }).is_previously_seen);
    return Number(leftSeen) - Number(rightSeen);
  });
}

export function freshnessRank(value: unknown): number {
  return value === "dated" ? 1 : 0;
}

function diversifyResults(results: SearchWebResult[]): SearchWebResult[] {
  const groups = new Map<string, SearchWebResult[]>();
  const seenRoles = new Set<string>();
  for (const result of results) {
    const domain = resultDomain(result.url);
    const group = groups.get(domain) ?? [];
    group.push(result);
    groups.set(domain, group);
  }
  const diversified: SearchWebResult[] = [];
  while (diversified.length < results.length) {
    let added = false;
    for (const group of groups.values()) {
      const next = group.shift();
      if (next) {
        diversified.push(next);
        added = true;
      }
    }
    if (!added) break;
  }
  return diversified;
}

function filterSearchResults(results: SearchWebResult[]): {
  internshipResults: SearchWebResult[];
  communityResults: SearchWebResult[];
} {
  const nonInternshipRolePattern =
    /\b(associate engineer|full-time position|new grad|senior|staff|principal|lead|manager|director|experienced professional)\b|\b(?:3|4|5)\+\s*years?\b/i;
  const internshipSignalPattern =
    /\b(internship|intern|student|university)\b/i;
  const discussionPattern =
    /\b(discussion|forum|community|q\s*&\s*a|interview questions|career advice|salary guide|how to)\b/i;
  const internshipResults: SearchWebResult[] = [];
  const communityResults: SearchWebResult[] = [];
  const seenRoles = new Set<string>();

  for (const result of results) {
    let domain = "";
    let pathname = "";

    try {
      const parsedUrl = new URL(result.url);
      domain = parsedUrl.hostname.toLowerCase();
      pathname = parsedUrl.pathname.toLowerCase();
    } catch {
      continue;
    }

    if (isAggregatorOrListingUrl(result.url)) {
      continue;
    }

    const searchableText = `${String(result.title ?? "")} ${String(
      result.description ?? ""
    )}`;
    const priority = sourcePriority(result.url);
    const isBlockedDomain = blockedDomains.some((candidate) =>
      domainMatches(domain, candidate)
    );
    const isDiscussionPage =
      discussionPattern.test(searchableText) ||
      /\/(blog|blogs|article|articles|news|forum|community|discussion)(\/|$)/i.test(
        pathname
      );

    if (isBlockedDomain || isDiscussionPage) {
      communityResults.push(result);
      continue;
    }

    if (nonInternshipRolePattern.test(searchableText)) {
      continue;
    }

    if (!internshipSignalPattern.test(searchableText) && priority < 90) {
      continue;
    }

    const roleKey = normalizedOpportunityRole(result);
    if (roleKey && seenRoles.has(roleKey)) continue;
    if (roleKey) seenRoles.add(roleKey);
    internshipResults.push({
      ...result,
      sourcePriority: priority,
      source_domain: domain,
      freshness: "unknown",
      is_previously_seen: false,
      domainRankPenaltyApplied: false,
    });
  }

  internshipResults.sort(
    (left, right) => Number(right.sourcePriority) - Number(left.sourcePriority)
  );

  return {
    internshipResults: applyDomainCap(diversifyResults(internshipResults)),
    communityResults,
  };
}

async function annotatePreviouslyShown(results: SearchWebResult[]): Promise<SearchWebResult[]> {
  try {
    const authClient = await createServerClient();
    const { data: authData } = await authClient.auth.getUser();
    if (!authData.user || results.length === 0) return results;
    const urls = results.map((result) => normalizeResultUrl(result.url));
    const client = createPersistenceClient();
    const { data } = await client.from("shown_internships").select("normalized_url").eq("user_id", authData.user.id).in("normalized_url", urls);
    const seen = new Set((data ?? []).map((row) => row.normalized_url));
    return results.map((result) => ({ ...result, is_previously_seen: seen.has(normalizeResultUrl(result.url)) }));
  } catch {
    return results;
  }
}

async function recordShownInternships(results: SearchWebResult[]): Promise<void> {
  try {
    const authClient = await createServerClient();
    const { data: authData } = await authClient.auth.getUser();
    if (!authData.user || results.length === 0) return;
    const now = new Date().toISOString();
    const rows = [...new Set(results.map((result) => normalizeResultUrl(result.url)))].map((normalized_url) => ({ user_id: authData.user.id, normalized_url, last_shown_at: now }));
    await createPersistenceClient().from("shown_internships").upsert(rows, { onConflict: "user_id,normalized_url" });
  } catch {
    // Tracking must never fail the search response.
  }
}

const SCRAPE_BUDGET = 3;

function hasStrongEducationRequirement(text: string): boolean {
  return /\b(current\s+ph\.?d\s+student|ph\.?d\s+required|doctoral\s+candidate|master'?s\s+degree\s+required|graduate\s+student\s+only)\b/i.test(
    text
  );
}

function isGenericPage(result: SearchWebResult): boolean {
  try {
    const parsedUrl = new URL(result.url);
    const path = parsedUrl.pathname.toLowerCase();
    const query = parsedUrl.search.toLowerCase();
    return (
      /\/(careers?|early-careers?|students?|programs?|search|categories?|listings?)(\/|$)/i.test(
        path
      ) ||
      /(^|[?&])(q|query|search|keyword)=/.test(query)
    );
  } catch {
    return false;
  }
}

function candidateRankingScore(result: SearchWebResult): number {
  const title = String(result.title ?? "");
  const description = String(result.description ?? "");
  const text = `${title} ${description}`;
  const titleHasInternship = /\b(internship|intern)\b/i.test(title);
  const specificInternshipTitle =
    /\b(software engineer|engineering|machine learning|ai)\s+intern\b/i.test(
      title
    );
  const studentSignal =
    /\b(student|undergraduate|university|college)\b/i.test(text);
  const undergraduateSignal =
    /\b(undergraduate|bachelor'?s student|college student|university student|currently pursuing (?:a )?bachelor'?s|currently pursuing a degree)\b/i.test(
      text
    );
  const score =
    Number(result.sourcePriority) * 0.2 +
    (specificInternshipTitle ? 70 : 0) +
    (titleHasInternship ? 45 : 0) +
    (studentSignal ? 15 : 0) +
    (undergraduateSignal ? 25 : 0) -
    (isGenericPage(result) ? 35 : 0) -
    (hasStrongEducationRequirement(text) ? 80 : 0);

  return score;
}

function normalizeTitle(title: unknown): string {
  return String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function selectScrapeCandidates(
  internshipResults: SearchWebResult[]
): SearchWebResult[] {
  const selectedCandidates: SearchWebResult[] = [];
  const seenTitles = new Set<string>();
  const selectedDomains = new Set<string>();

  const sortedResults = [...internshipResults].sort(
    (left, right) => candidateRankingScore(right) - candidateRankingScore(left)
  );

  const addCandidate = (result: SearchWebResult, enforceDomainDiversity: boolean): void => {
    if (selectedCandidates.length >= SCRAPE_BUDGET) return;

    const normalizedTitle = normalizeTitle(result.title);
    const text = `${String(result.title ?? "")} ${String(
      result.description ?? ""
    )}`;

    if (hasStrongEducationRequirement(text)) return;

    const domain = resultDomain(result.url);
    if (enforceDomainDiversity && selectedDomains.has(domain)) return;

    if (normalizedTitle && seenTitles.has(normalizedTitle)) {
      return;
    }

    if (normalizedTitle) {
      seenTitles.add(normalizedTitle);
    }

    selectedCandidates.push({
      url: result.url,
      title: typeof result.title === "string" ? result.title : undefined,
      description:
        typeof result.description === "string"
          ? result.description
          : undefined,
      position:
        typeof result.position === "number" ? result.position : undefined,
      sourcePriority: Number(result.sourcePriority),
    });
    selectedDomains.add(domain);
  };

  for (const result of sortedResults) addCandidate(result, true);
  if (selectedCandidates.length < SCRAPE_BUDGET) {
    for (const result of sortedResults) {
      if (selectedCandidates.length >= SCRAPE_BUDGET) break;
      addCandidate(result, false);
    }
  }

  return selectedCandidates;
}

type ScrapedCandidate = {
  url: string;
  title?: string;
  content: string;
};

async function scrapeSelectedCandidates(
  candidates: SearchWebResult[]
): Promise<{
  scrapedCandidates: ScrapedCandidate[];
  scrapeFailureCount: number;
}> {
  const settledScrapes = await Promise.allSettled(
    candidates.map(async (candidate): Promise<ScrapedCandidate> => {
      const scrapedPage = await firecrawl.scrape(candidate.url, {
        formats: ["markdown"],
        onlyMainContent: true,
      });
      const content =
        typeof scrapedPage.markdown === "string"
          ? scrapedPage.markdown
          : typeof scrapedPage.html === "string"
            ? scrapedPage.html
            : typeof scrapedPage.rawHtml === "string"
              ? scrapedPage.rawHtml
              : "";

      return {
        url: candidate.url,
        title:
          typeof candidate.title === "string" ? candidate.title : undefined,
        content,
      };
    })
  );

  const scrapedCandidates: ScrapedCandidate[] = [];
  let scrapeFailureCount = 0;

  for (const settledScrape of settledScrapes) {
    if (settledScrape.status === "fulfilled") {
      scrapedCandidates.push(settledScrape.value);
    } else {
      scrapeFailureCount += 1;
    }
  }

  return { scrapedCandidates, scrapeFailureCount };
}

type StructuredInternship = {
  id?: string;
  internshipId?: string;
  sourceUrl: string;
  applicationUrl: string | null;
  company: string | null;
  role: string | null;
  description: string | null;
  location: string | null;
  workMode: WorkMode | null;
  requiredSkills: string[];
  experienceRequired: string | null;
  graduationRequirements: string | null;
  stipend: string | null;
  duration: string | null;
};

function cleanExtractedText(value: string, maxLength = 800): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[`*_>#]/g, "")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim();
}

function extractSection(content: string, headings: string[]): string | null {
  const headingPattern = headings.join("|");
  const sectionPattern = new RegExp(
    `(?:^|\\n)#{1,6}\\s*(?:${headingPattern})\\s*\\n([\\s\\S]*?)(?=\\n#{1,6}\\s|$)`,
    "i"
  );
  const match = content.match(sectionPattern);
  const section = match?.[1] ? cleanExtractedText(match[1]) : "";
  return section || null;
}

function extractApplicationUrl(content: string, sourceUrl: string): string {
  const markdownLinks = [
    ...content.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi),
  ].map((match) => match[1]);
  return (
    markdownLinks.find((url) => /apply/i.test(url)) ?? sourceUrl
  );
}

export function extractCompanyAndRole(
  title: string,
  sourceUrl: string
): { company: string | null; role: string | null } {
  const separatorIndex = title.indexOf(" - ");
  if (separatorIndex > 0) {
    return {
      company: title.slice(0, separatorIndex).trim() || null,
      role: title.slice(separatorIndex + 3).trim() || null,
    };
  }

  try {
    const parsedUrl = new URL(sourceUrl);
    const hostname = parsedUrl.hostname.toLowerCase();
    const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
    const companySlug =
      hostname === "jobs.lever.co"
        ? pathSegments[0]
        : hostname === "boards.greenhouse.io" || hostname.endsWith(".greenhouse.io")
          ? pathSegments[0]
          : hostname === "jobs.ashbyhq.com"
            ? pathSegments[0]
            : undefined;
    const atsCompany = companySlug;
    if (!atsCompany) {
      const rootDomain = hostname.replace(/^www\./, "").split(".")[0];
      const knownCompanyNames: Record<string, string> = {
        jpmorganchase: "JPMorgan Chase",
      };
      const companyName = knownCompanyNames[rootDomain] ?? rootDomain
        .replace(/[-_]+/g, " ")
        .replace(/\b(inc|llc|ltd|corp|corporation|company|co)\b$/i, "")
        .trim()
        .replace(/\b\w/g, (character) => character.toUpperCase());
      const isKnownAts = atsDomains.some((candidate) => domainMatches(hostname, candidate));
      const isAggregator = aggregatorDomains.some((candidate) => domainMatches(hostname, candidate));
      return {
        company: !isKnownAts && !isAggregator && companyName ? companyName : null,
        role: title.trim() || null,
      };
    }
    return {
      company: atsCompany
        ? atsCompany
            .split(/[-_]/g)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ")
        : null,
      role: title.trim() || null,
    };
  } catch {
    return { company: null, role: title.trim() || null };
  }
}

function extractLocation(content: string): string | null {
  const beginning = content.slice(0, 1800);
  const labeledLocation = beginning.match(
    /(?:location|locations?)\s*[:\-]\s*([^\n|]+)/i
  )?.[1];
  if (labeledLocation) {
    return cleanExtractedText(labeledLocation, 160) || null;
  }

  const locationPattern =
    /\b(remote|work from anywhere|united states|india|bengaluru|bangalore|new york)\b/i;
  const match = beginning.match(locationPattern)?.[1];
  return match ? match.replace(/\s+/g, " ").trim() : null;
}

function extractWorkMode(content: string): WorkMode | null {
  const beginning = content.slice(0, 2200).toLowerCase();
  if (/remote[- ]first|work from anywhere|\bremote\b/.test(beginning)) {
    return "remote";
  }
  if (/\bhybrid\b/.test(beginning)) {
    return "hybrid";
  }
  if (/on[- ]site|in office|\bonsite\b/.test(beginning)) {
    return "onsite";
  }
  return null;
}

function extractDescription(content: string): string | null {
  const sectionDescription = extractSection(content, [
    "About the Role",
    "Job Description",
    "What You'll Do",
    "What You’ll Do",
    "Responsibilities",
    "Key Responsibilities",
  ]);
  if (sectionDescription) {
    return sectionDescription;
  }

  const candidateParagraph = content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .find(
      (paragraph) =>
        paragraph.length >= 40 &&
        !/^!\[/.test(paragraph) &&
        !/^\[.*\]\(https?:\/\//.test(paragraph) &&
        !/\b(?:apply|sign in|log in|home|careers)\b/i.test(paragraph)
    );

  return candidateParagraph
    ? cleanExtractedText(candidateParagraph, 800) || null
    : null;
}

const recognizedSkills: Array<{ label: string; patterns: string[] }> = [
  { label: "JavaScript", patterns: ["javascript"] },
  { label: "TypeScript", patterns: ["typescript"] },
  { label: "React", patterns: ["react"] },
  { label: "Next.js", patterns: ["next.js", "nextjs"] },
  { label: "Node.js", patterns: ["node.js", "nodejs"] },
  { label: "Python", patterns: ["python"] },
  { label: "Java", patterns: ["java"] },
  { label: "C++", patterns: ["c++"] },
  { label: "SQL", patterns: ["sql"] },
  { label: "PostgreSQL", patterns: ["postgresql", "postgres"] },
  { label: "MongoDB", patterns: ["mongodb", "mongo db"] },
  { label: "AWS", patterns: ["aws", "amazon web services"] },
  { label: "Docker", patterns: ["docker"] },
  { label: "Kubernetes", patterns: ["kubernetes", "k8s"] },
  { label: "Git", patterns: ["git"] },
  { label: "REST APIs", patterns: ["rest api", "restful api"] },
  { label: "GraphQL", patterns: ["graphql"] },
  { label: "Machine Learning", patterns: ["machine learning"] },
  { label: "Deep Learning", patterns: ["deep learning"] },
  { label: "AI/ML", patterns: ["ai/ml", "artificial intelligence"] },
  { label: "LLM", patterns: ["llm", "llms"] },
  { label: "RAG", patterns: ["rag"] },
  { label: "Generative AI", patterns: ["generative ai"] },
  { label: "Agentic AI", patterns: ["agentic ai"] },
  { label: "TensorFlow", patterns: ["tensorflow"] },
  { label: "PyTorch", patterns: ["pytorch"] },
  { label: "Data Structures", patterns: ["data structures"] },
  { label: "Algorithms", patterns: ["algorithms", "data structures & algorithms"] },
  { label: "System Design", patterns: ["system design"] },
  { label: "Cloud", patterns: ["cloud computing", "cloud platform"] },
  { label: "API Integration", patterns: ["api integration"] },
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractRequiredSkills(content: string): string[] {
  return recognizedSkills
    .filter(({ patterns }) =>
      patterns.some((pattern) =>
        new RegExp(
          `(?<![A-Za-z0-9])${escapeRegex(pattern)}(?![A-Za-z0-9])`,
          "i"
        ).test(content)
      )
    )
    .map(({ label }) => label);
}

function extractExperienceRequired(content: string): string | null {
  const explicitYears = content.match(/\b\d+\s*(?:[-–]\s*\d+|\+)?\s*years?\b/i)?.[0];
  if (explicitYears) {
    return cleanExtractedText(explicitYears, 120);
  }
  const preference = content.match(
    /\b(?:prior internship experience preferred|relevant projects preferred)\b/i
  )?.[0];
  return preference ? cleanExtractedText(preference, 160) : null;
}

function extractGraduationRequirements(content: string): string | null {
  const educationSignal =
    /\b(currently pursuing|pursuing (?:a )?degree|completed (?:a )?degree|bachelor'?s degree|master'?s degree|undergraduate|graduate|university student|computer science|related field)\b/i;
  const candidates: string[] = [];
  const section = extractSection(content, [
    "Qualifications",
    "Requirements",
    "Academic Background",
    "Education",
  ]);
  if (section) {
    candidates.push(section);
  }

  for (const match of content.matchAll(
    /(?:Academic Background|Education|Degree|Eligibility)\s*[:\-]\s*([^\n]+)/gi
  )) {
    if (match[1]) {
      candidates.push(match[1]);
    }
  }

  candidates.push(content);
  for (const candidate of candidates) {
    const meaningfulSentence = candidate
      .split(/\n|(?<=[.!?])\s+/)
      .map((sentence) => cleanExtractedText(sentence, 500))
      .find((sentence) => educationSignal.test(sentence));
    if (meaningfulSentence) {
      return meaningfulSentence;
    }
  }

  return null;
}

function extractStipend(content: string): string | null {
  const line = content
    .split("\n")
    .find((candidate) =>
      /(?:₹|\$|\bINR\b|\bstipend\b|\bsalary\b|\bcompensation\b|\bhourly pay\b)/i.test(
        candidate
      )
    );
  return line ? cleanExtractedText(line, 240) : null;
}

function extractDuration(content: string): string | null {
  const duration = content.match(
    /\b\d+\s*(?:[-–]\s*\d+)?\s*months?\b|\bsummer\s+\d{4}\b/i
  )?.[0];
  return duration ? cleanExtractedText(duration, 120) : null;
}

function extractStructuredInternship(
  candidate: ScrapedCandidate
): StructuredInternship {
  try {
    const title = candidate.title ?? "";
    const { company, role } = extractCompanyAndRole(title, candidate.url);
    return {
      sourceUrl: candidate.url,
      applicationUrl: extractApplicationUrl(candidate.content, candidate.url),
      company,
      role,
      description: extractDescription(candidate.content),
      location: extractLocation(candidate.content),
      workMode: extractWorkMode(candidate.content),
      requiredSkills: extractRequiredSkills(candidate.content),
      experienceRequired: extractExperienceRequired(candidate.content),
      graduationRequirements: extractGraduationRequirements(candidate.content),
      stipend: extractStipend(candidate.content),
      duration: extractDuration(candidate.content),
    };
  } catch {
    return {
      sourceUrl: candidate.url,
      applicationUrl: candidate.url,
      company: null,
      role: candidate.title ?? null,
      description: null,
      location: null,
      workMode: null,
      requiredSkills: [],
      experienceRequired: null,
      graduationRequirements: null,
      stipend: null,
      duration: null,
    };
  }
}

type EligibilityStatus =
  | "eligible"
  | "possibly_eligible"
  | "not_eligible";

type EligibilityResult = {
  status: EligibilityStatus;
  reasons: string[];
};

function normalizeEligibilityText(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

function addEligibilityReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) {
    reasons.push(reason);
  }
}

function selectedExperienceMaximum(
  experience: SearchFilters["experience"]
): number | null {
  switch (experience) {
    case "0":
      return 0;
    case "0-1":
      return 1;
    case "1-2":
      return 2;
    case "2+":
      return Number.POSITIVE_INFINITY;
    default:
      return null;
  }
}

function requiredExperienceMaximum(value: string): number | null {
  const match = value.match(/(\d+)\s*(?:[-–]\s*(\d+)|\+)?\s*years?/i);
  if (!match) {
    return null;
  }
  return match[2] ? Number(match[2]) : Number(match[1]);
}

function evaluateEligibility(
  internship: StructuredInternship,
  filters: SearchFilters
): EligibilityResult {
  const reasons: string[] = [];
  let hardConflict = false;
  let softConcern = false;

  const education = normalizeEligibilityText(
    internship.graduationRequirements ?? ""
  );
  if (!education) {
    softConcern = true;
    addEligibilityReason(
      reasons,
      "Graduation requirements could not be fully verified."
    );
  } else if (
    /\b(phd required|current ph\.?d student|doctoral candidate|master'?s degree required|graduate student only)\b/i.test(
      education
    )
  ) {
    hardConflict = true;
    addEligibilityReason(
      reasons,
      /\b(phd|required|doctoral)\b/i.test(education)
        ? "Requires a PhD or doctoral background, which does not match the selected graduation profile."
        : "Requires a graduate-only qualification, which does not match the selected graduation profile."
    );
  } else {
    addEligibilityReason(reasons, "Education requirements appear compatible.");
  }

  const experienceText = normalizeEligibilityText(
    internship.experienceRequired ?? ""
  );
  const userExperienceMaximum = selectedExperienceMaximum(filters.experience);
  const requiredMaximum = experienceText
    ? requiredExperienceMaximum(experienceText)
    : null;
  if (!experienceText) {
    softConcern = true;
    addEligibilityReason(
      reasons,
      "Experience requirements could not be fully verified."
    );
  } else if (
    requiredMaximum !== null &&
    userExperienceMaximum !== null &&
    requiredMaximum > userExperienceMaximum
  ) {
    hardConflict = true;
    addEligibilityReason(
      reasons,
      "The required experience exceeds your selected experience range."
    );
  } else if (/\b(preferred|projects?|internship experience)\b/i.test(experienceText)) {
    softConcern = true;
    addEligibilityReason(
      reasons,
      "Additional experience is preferred but does not appear to be mandatory."
    );
  } else {
    addEligibilityReason(reasons, "Experience requirements appear compatible.");
  }

  const selectedWorkMode = filters.workMode;
  const internshipWorkMode = internship.workMode;
  if (selectedWorkMode && internshipWorkMode) {
    if (selectedWorkMode === internshipWorkMode) {
      addEligibilityReason(
        reasons,
        `Work mode matches your preference: ${selectedWorkMode}.`
      );
    } else {
      softConcern = true;
      addEligibilityReason(
        reasons,
        `Role is ${internshipWorkMode}, while you selected ${selectedWorkMode}.`
      );
    }
  }

  const selectedLocation = filters.location?.trim();
  const internshipLocation = internship.location?.trim();
  if (selectedLocation && internshipLocation) {
    const selectedLocationText = normalizeEligibilityText(selectedLocation);
    const internshipLocationText = normalizeEligibilityText(internshipLocation);
    if (
      selectedLocationText.includes(internshipLocationText) ||
      internshipLocationText.includes(selectedLocationText)
    ) {
      addEligibilityReason(reasons, "Role location matches your preference.");
    } else {
      softConcern = true;
      addEligibilityReason(
        reasons,
        `Role location is ${internshipLocation}, while your selected location is ${selectedLocation}.`
      );
    }
  }

  const selectedSkills = [...
    new Set((filters.skills ?? []).map(normalizeEligibilityText).filter(Boolean)),
  ];
  const requiredSkills = [...
    new Set(
      internship.requiredSkills
        .map(normalizeEligibilityText)
        .filter(Boolean)
    ),
  ];
  if (selectedSkills.length > 0) {
    const matchedSkills = selectedSkills.filter((skill) =>
      requiredSkills.some(
        (requiredSkill) =>
          requiredSkill === skill ||
          requiredSkill.includes(skill) ||
          skill.includes(requiredSkill)
      )
    );
    if (matchedSkills.length > 0) {
      addEligibilityReason(
        reasons,
        `Matches ${matchedSkills.length} of the listed technical skills.`
      );
    } else {
      softConcern = true;
      addEligibilityReason(
        reasons,
        "No direct skill match was found from the selected skills."
      );
    }
  }

  if (hardConflict) {
    return { status: "not_eligible", reasons };
  }
  if (softConcern) {
    addEligibilityReason(reasons, "No hard eligibility conflict was found.");
    return { status: "possibly_eligible", reasons };
  }
  return { status: "eligible", reasons };
}

function roleKeywords(role: string): string[] {
  const normalizedRole = normalizeEligibilityText(role);
  if (normalizedRole.includes("ai") || normalizedRole.includes("machine")) {
    return [
      "ai",
      "artificial intelligence",
      "machine learning",
      "ml",
      "generative ai",
      "gen ai",
      "llm",
    ];
  }
  if (normalizedRole.includes("frontend") || normalizedRole.includes("front end")) {
    return ["frontend", "front end", "react", "ui", "web"];
  }
  if (normalizedRole.includes("backend") || normalizedRole.includes("back end")) {
    return ["backend", "back end", "node", "api", "server"];
  }
  if (normalizedRole.includes("software") || normalizedRole.includes("full stack")) {
    return [
      "software engineer",
      "software engineering",
      "developer",
      "engineering",
    ];
  }
  return normalizedRole.split(/\s+/).filter((keyword) => keyword.length > 2);
}

function calculateRoleScore(
  internship: StructuredInternship,
  filters: SearchFilters,
  reasons: string[]
): number {
  const searchableRole = normalizeEligibilityText(
    `${internship.role ?? ""} ${internship.description ?? ""}`
  );
  const keywords = roleKeywords(filters.role);
  const matchedKeywords = keywords.filter((keyword) =>
    searchableRole.includes(keyword)
  );

  if (matchedKeywords.length >= 2) {
    reasons.push(`Strong role relevance to your ${filters.role} search.`);
    return 30;
  }
  if (matchedKeywords.length === 1) {
    reasons.push(`Partial role relevance to your ${filters.role} search.`);
    return 20;
  }
  reasons.push("Role relevance is limited or unclear.");
  return searchableRole ? 5 : 0;
}

function normalizedSkillSet(skills: string[] | null | undefined): string[] {
  return [
    ...new Set(
      (skills ?? []).map(normalizeEligibilityText).filter(Boolean)
    ),
  ];
}

function calculateSkillsScore(
  internship: StructuredInternship,
  filters: SearchFilters,
  reasons: string[]
): number {
  const selectedSkills = normalizedSkillSet(filters.skills);
  if (selectedSkills.length === 0) {
    reasons.push("No skills were selected, so skills were scored neutrally.");
    return 30;
  }

  const requiredSkills = normalizedSkillSet(internship.requiredSkills);
  const matchedSkills = selectedSkills.filter((skill) =>
    requiredSkills.some(
      (requiredSkill) =>
        requiredSkill === skill ||
        requiredSkill.includes(skill) ||
        skill.includes(requiredSkill)
    )
  );
  const score = Math.round((matchedSkills.length / selectedSkills.length) * 30);
  if (matchedSkills.length > 0) {
    reasons.push(
      `Matches ${matchedSkills.length} of your ${selectedSkills.length} selected skills.`
    );
  } else {
    reasons.push("No direct skill match was found from your selected skills.");
  }
  return score;
}

function calculateWorkModeScore(
  internship: StructuredInternship,
  filters: SearchFilters,
  reasons: string[]
): number {
  if (!filters.workMode) {
    reasons.push("Work mode was scored neutrally because no preference was selected.");
    return 10;
  }
  if (!internship.workMode) {
    reasons.push("Internship work mode is unknown.");
    return 5;
  }
  if (internship.workMode === filters.workMode) {
    reasons.push(`Work mode matches your preference: ${filters.workMode}.`);
    return 10;
  }
  reasons.push(
    `Work mode differs from your preference: ${internship.workMode}.`
  );
  return 0;
}

function calculateLocationScore(
  internship: StructuredInternship,
  filters: SearchFilters,
  reasons: string[]
): number {
  const selectedLocation = filters.location?.trim();
  if (!selectedLocation) {
    reasons.push("Location was scored neutrally because no preference was selected.");
    return 10;
  }
  if (internship.workMode === "remote") {
    reasons.push("Remote work satisfies the location preference.");
    return 10;
  }
  if (!internship.location) {
    reasons.push("Internship location is unknown.");
    return 5;
  }
  const selected = normalizeEligibilityText(selectedLocation);
  const location = normalizeEligibilityText(internship.location);
  if (selected.includes(location) || location.includes(selected)) {
    reasons.push("Role location matches your preference.");
    return 10;
  }
  reasons.push("Role location differs from your selected preference.");
  return 0;
}

function calculateMatchScore(
  internship: StructuredInternship,
  eligibility: EligibilityResult,
  filters: SearchFilters
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const roleScore = calculateRoleScore(internship, filters, reasons);
  const skillsScore = calculateSkillsScore(internship, filters, reasons);
  const workModeScore = calculateWorkModeScore(internship, filters, reasons);
  const locationScore = calculateLocationScore(internship, filters, reasons);
  const eligibilityScore =
    eligibility.status === "eligible"
      ? 20
      : eligibility.status === "possibly_eligible"
        ? 12
        : 0;

  if (eligibility.status === "eligible") {
    reasons.push("Education and experience requirements appear compatible.");
  } else if (eligibility.status === "possibly_eligible") {
    reasons.push("Some eligibility details remain uncertain.");
  } else {
    reasons.push("Eligibility conflicts reduce the match score.");
  }

  const score = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        roleScore + skillsScore + workModeScore + locationScore + eligibilityScore
      )
    )
  );
  return { score, reasons: [...new Set(reasons)] };
}

function eligibilityStatusRank(status: EligibilityStatus): number {
  return status === "eligible" ? 3 : status === "possibly_eligible" ? 2 : 1;
}

type VerificationStatus =
  | "verified"
  | "likely_legitimate"
  | "needs_review"
  | "suspicious";

type VerificationResult = {
  status: VerificationStatus;
  score: number;
  reasons: string[];
};

const verificationAtsDomains = [
  "jobs.lever.co",
  "boards.greenhouse.io",
  "jobs.ashbyhq.com",
  "jobs.smartrecruiters.com",
  "myworkdayjobs.com",
];

function getDomain(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isTrustedVerificationAts(url: string | null): boolean {
  const domain = getDomain(url);
  return Boolean(
    domain &&
      verificationAtsDomains.some((candidate) =>
        domainMatches(domain, candidate)
      )
  );
}

function isCareersOrJobsUrl(url: string | null): boolean {
  if (!url) {
    return false;
  }
  try {
    const parsedUrl = new URL(url);
    return (
      /\/(careers?|jobs?)(\/|$)/i.test(parsedUrl.pathname) ||
      /^(careers?|jobs?)\./i.test(parsedUrl.hostname)
    );
  } catch {
    return false;
  }
}

function extractContactEmails(content: string): string[] {
  return [
    ...new Set(
      content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []
    ),
  ];
}

function evaluateVerification(
  internship: StructuredInternship,
  scrapedContent: string
): VerificationResult {
  let score = 50;
  const reasons: string[] = [];
  const sourceDomain = getDomain(internship.sourceUrl);
  const applicationDomain = getDomain(internship.applicationUrl);
  const content = scrapedContent || "";
  const lowerContent = content.toLowerCase();
  const emails = extractContactEmails(content);
  const trustedAts =
    isTrustedVerificationAts(internship.sourceUrl) ||
    isTrustedVerificationAts(internship.applicationUrl);
  const officialCareers =
    isCareersOrJobsUrl(internship.sourceUrl) ||
    isCareersOrJobsUrl(internship.applicationUrl);

  if (trustedAts) {
    score += 25;
    reasons.push("Listed through a recognized ATS platform.");
  } else if (officialCareers) {
    score += 18;
    reasons.push("Listed on a company careers or jobs domain.");
  }

  if (internship.company) {
    score += 5;
  } else {
    score -= 8;
    reasons.push("Limited company identity information was available.");
  }

  const detailSignals = [
    internship.role,
    internship.description,
    internship.graduationRequirements,
    internship.requiredSkills.length > 0 ? "skills" : null,
    internship.location,
    internship.workMode,
    internship.applicationUrl,
  ].filter(Boolean).length;
  if (detailSignals >= 5) {
    score += 12;
    reasons.push("Posting includes detailed role information and requirements.");
  } else if (detailSignals <= 2) {
    score -= 8;
    reasons.push("Job description contains very limited role information.");
  }

  if (internship.company && (sourceDomain || applicationDomain)) {
    const companyToken = internship.company
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const matchingDomain = [sourceDomain, applicationDomain].find((domain) =>
      domain?.replace(/[^a-z0-9]/g, "").includes(companyToken)
    );
    if (matchingDomain && companyToken.length >= 4) {
      score += 8;
      reasons.push("Company identity is consistent with the posting domain.");
    }
  }

  const paymentSignal =
    /registration fee|pay to apply|application fee|training fee|security deposit|refundable deposit|processing fee|pay before joining|send money|transfer money|upi payment|pay\s+(?:₹|\$)/i.test(
      lowerContent
    );
  if (paymentSignal) {
    score -= 45;
    reasons.push("Posting appears to request payment from applicants.");
  }

  const suspiciousClaim =
    /guaranteed (?:job|placement)|earn lakhs easily|no experience needed earn|immediate joining guaranteed|limited seats pay now|urgent payment required/i.test(
      lowerContent
    );
  if (suspiciousClaim) {
    score -= 25;
    reasons.push("Suspicious marketing or payment-related language was detected.");
  }

  const genericEmail = emails.some((email) =>
    /@(gmail|yahoo|outlook|hotmail)\./i.test(email)
  );
  const companyEmail = emails.some((email) => {
    const emailDomain = email.split("@")[1]?.toLowerCase();
    return Boolean(
      emailDomain &&
        ((sourceDomain && domainMatches(emailDomain, sourceDomain)) ||
          (applicationDomain && domainMatches(emailDomain, applicationDomain)))
    );
  });
  if (companyEmail) {
    score += 8;
    reasons.push("Company contact uses a matching company domain.");
  } else if (genericEmail && emails.length === 1) {
    score -= 5;
    reasons.push("Posting uses a generic email contact.");
  }
  if (paymentSignal && genericEmail) {
    score -= 15;
    reasons.push("Payment language is paired with a generic email address.");
  }

  if (!internship.applicationUrl) {
    score -= 8;
    reasons.push("No clear application URL was found.");
  } else if (
    applicationDomain &&
    sourceDomain &&
    (applicationDomain === sourceDomain || trustedAts)
  ) {
    score += 5;
    reasons.push("Application link matches the posting platform.");
  }

  if (content.length < 180 || !/\b(responsibilit|qualification|requirement|role)\b/i.test(content)) {
    score -= 8;
    reasons.push("Posting contains limited concrete job details.");
  }

  const boundedScore = Math.round(Math.max(0, Math.min(100, score)));
  let status: VerificationStatus;
  if (boundedScore >= 80 && (trustedAts || officialCareers)) {
    status = "verified";
  } else if (boundedScore >= 60) {
    status = "likely_legitimate";
  } else if (boundedScore >= 35) {
    status = "needs_review";
  } else {
    status = "suspicious";
  }

  return {
    status,
    score: boundedScore,
    reasons: [...new Set(reasons)].slice(0, 5),
  };
}

async function persistVerificationResults(
  verificationResults: Array<{
    internship: StructuredInternship;
    verification: VerificationResult;
  }>
): Promise<Map<string, string>> {
  const verifiedAt = new Date().toISOString();
  const persistedIds = new Map<string, string>();
  const settled = await Promise.allSettled(
    verificationResults.map(async ({ internship, verification }) => {
      const company = internship.company?.trim() || null;
      if (!company) {
        console.warn("Skipping internship persistence: missing required field.", {
          sourceUrl: internship.sourceUrl,
          missingField: "company",
        });
        return { sourceUrl: internship.sourceUrl, id: null };
      }
      const databaseRecord: InternshipInsert = {
        company,
        role: internship.role,
        description: internship.description,
        location: internship.location,
        workMode: internship.workMode,
        postedDate: null,
        deadline: null,
        duration: internship.duration,
        stipend: internship.stipend,
        experienceRequired: internship.experienceRequired,
        graduationRequirements: internship.graduationRequirements,
        requiredSkills: internship.requiredSkills,
        applicationUrl: internship.applicationUrl,
        sourceUrl: internship.sourceUrl,
        sourceDomain: getDomain(internship.sourceUrl),
        verificationStatus: verification.status,
        verificationScore: verification.score,
        verificationReasons: verification.reasons,
        lastVerifiedAt: verifiedAt,
      };

      const saved = await upsertInternship(databaseRecord) as { id?: unknown } | null;
      return { sourceUrl: internship.sourceUrl, id: typeof saved?.id === "string" ? saved.id : null };
    })
  );
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value.id) {
      persistedIds.set(result.value.sourceUrl, result.value.id);
    } else if (result.status === "fulfilled") {
      console.error("Internship persistence returned no database ID.", {
        sourceUrl: result.value.sourceUrl,
      });
    } else {
      console.error("Internship persistence failed.", result.reason);
    }
  }
  return persistedIds;
}

function cachedSkills(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((skill): skill is string => typeof skill === "string")
    : [];
}

function cachedReasons(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((reason): reason is string => typeof reason === "string")
    : [];
}

function cachedVerificationStatus(
  value: CachedInternshipRow["verification_status"]
): VerificationStatus {
  return value ?? "needs_review";
}

function createCachedVerificationResults(
  rows: CachedInternshipRow[],
  filters: SearchFilters
) {
  return rows.map((row) => {
    const structuredInternship: StructuredInternship = {
      sourceUrl: row.source_url,
      applicationUrl: row.application_url,
      company: row.company,
      role: row.role,
      description: row.description,
      location: row.location,
      workMode: row.work_mode,
      requiredSkills: cachedSkills(row.required_skills),
      experienceRequired: row.experience_required,
      graduationRequirements: row.graduation_requirements,
      stipend: row.stipend,
      duration: row.duration,
    };
    const eligibility = evaluateEligibility(structuredInternship, filters);
    const match = calculateMatchScore(structuredInternship, eligibility, filters);

    return {
      internship: {
        id: row.id,
        internshipId: row.id,
        company: row.company,
        role: row.role,
        description: row.description,
        location: row.location,
        workMode: row.work_mode,
        postedDate: row.posted_date,
        deadline: row.deadline,
        duration: row.duration,
        stipend: row.stipend,
        experienceRequired: row.experience_required,
        graduationRequirements: row.graduation_requirements,
        requiredSkills: cachedSkills(row.required_skills),
        applicationUrl: row.application_url,
        sourceUrl: row.source_url,
        sourceDomain: row.source_domain,
        status: row.status,
        lastVerifiedAt: row.last_verified_at,
        createdAt: row.created_at,
      },
      eligibility,
      match,
      verification: {
        status: cachedVerificationStatus(row.verification_status),
        score: row.verification_score ?? 0,
        reasons: cachedReasons(row.verification_reasons),
      },
    };
  });
}

type VerificationResultItem = {
  internship: {
    id?: string;
    internshipId?: string;
    sourceUrl: string | null;
    applicationUrl?: string | null;
  };
  match: {
    score: number;
  };
  verification: {
    score: number;
  };
  [key: string]: unknown;
};

function mergeVerificationResults(
  cachedResults: VerificationResultItem[],
  freshResults: VerificationResultItem[]
): VerificationResultItem[] {
  const bySourceUrl = new Map<string, VerificationResultItem>();

  for (const result of cachedResults) {
    if (result.internship.sourceUrl) {
      bySourceUrl.set(result.internship.sourceUrl, result);
    }
  }
  for (const result of freshResults) {
    if (result.internship.sourceUrl) {
      bySourceUrl.set(result.internship.sourceUrl, result);
    }
  }

  return [...bySourceUrl.values()].sort(
    (left, right) =>
      right.match.score - left.match.score ||
      right.verification.score - left.verification.score
  );
}

function generateSearchQueries(filters: SearchFilters): string[] {
  const { role, workMode, location, skills, graduationYear, experience } =
    filters;
  const modePhrase =
    workMode === "onsite"
      ? location
        ? `${location} onsite`
        : "onsite"
      : workMode ?? "";
  const selectedSkills = skills?.slice(0, 3).join(" ");
  const queries = [
    `${role} internship${modePhrase ? ` ${modePhrase}` : ""}`,
    `${role} intern${location ? ` ${location}` : modePhrase ? ` ${modePhrase}` : ""}`,
    selectedSkills
      ? `${role} internship ${selectedSkills}`
      : `${role} internship student`,
    `${role} internship ${graduationYear} student${experience === "0" ? " fresher" : ""}`,
    `(site:boards.greenhouse.io OR site:ashbyhq.com OR site:jobs.lever.co) "${role}" intern`,
  ];

  return [...new Set(queries)].slice(0, 5);
}

export async function POST(request: Request) {
  let identifier = getRequestIp(request);
  try {
    const authClient = await createServerClient();
    const { data: authData } = await authClient.auth.getUser();
    if (authData.user?.id) identifier = authData.user.id;
  } catch (error) {
    console.error("Search rate-limit auth lookup failed:", error);
  }

  try {
    const { data: allowed, error } = await createPersistenceClient().rpc(
      "check_rate_limit",
      {
        p_identifier: identifier,
        p_route: RATE_LIMIT_ROUTE,
        p_max_requests: RATE_LIMIT_MAX_REQUESTS,
        p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
      }
    );
    if (error) throw error;
    if (allowed === false) {
      return NextResponse.json(
        { error: "Too many search requests. Please try again shortly." },
        {
          status: 429,
          headers: { "Retry-After": String(RATE_LIMIT_WINDOW_SECONDS) },
        }
      );
    }
  } catch (error) {
    // Fail open so a limiter outage does not block legitimate searches.
    console.error("Search rate-limit check failed; allowing request:", error);
  }

  try {
    const body: SearchFilters = await request.json();

    if (!body.role || typeof body.role !== "string") {
      return NextResponse.json(
        { error: "Role is required." },
        { status: 400 }
      );
    }

    if (
      typeof body.graduationYear !== "number" ||
      !Number.isFinite(body.graduationYear)
    ) {
      return NextResponse.json(
        { error: "A valid graduation year is required." },
        { status: 400 }
      );
    }

    if (
      typeof body.postedWithinDays !== "number" ||
      body.postedWithinDays <= 0
    ) {
      return NextResponse.json(
        { error: "Posted within days must be a positive number." },
        { status: 400 }
      );
    }

    if (typeof body.paidOnly !== "boolean") {
      return NextResponse.json(
        { error: "Paid only must be true or false." },
        { status: 400 }
      );
    }

    if (
      body.skills !== undefined &&
      (!Array.isArray(body.skills) ||
        !body.skills.every((skill) => typeof skill === "string"))
    ) {
      return NextResponse.json(
        { error: "Skills must be an array of strings." },
        { status: 400 }
      );
    }

    if (
      body.location !== undefined &&
      typeof body.location !== "string"
    ) {
      return NextResponse.json(
        { error: "Location must be a string." },
        { status: 400 }
      );
    }

    if (
      body.workMode !== undefined &&
      !validWorkModes.includes(body.workMode)
    ) {
      return NextResponse.json(
        { error: "Invalid work mode." },
        { status: 400 }
      );
    }

    if (
      body.experience !== undefined &&
      !validExperienceRanges.includes(body.experience)
    ) {
      return NextResponse.json(
        { error: "Invalid experience range." },
        { status: 400 }
      );
    }

    if (
      body.minStipend !== undefined &&
      (typeof body.minStipend !== "number" ||
        body.minStipend < 0)
    ) {
      return NextResponse.json(
        { error: "Minimum stipend must be a non-negative number." },
        { status: 400 }
      );
    }

    let cachedInternships: CachedInternshipRow[] = [];
    try {
      cachedInternships = await getCachedInternships(body);
    } catch {
      cachedInternships = [];
    }

    if (cachedInternships.length >= 3) {
      const verificationResults = createCachedVerificationResults(
        cachedInternships,
        body
      );
      const structuredInternships = verificationResults.map(
        ({ internship }) => ({
          sourceUrl: internship.sourceUrl ?? "",
          applicationUrl: internship.applicationUrl,
          company: internship.company,
          role: internship.role,
          description: internship.description,
          location: internship.location,
          workMode: internship.workMode,
          requiredSkills: internship.requiredSkills ?? [],
          experienceRequired: internship.experienceRequired,
          graduationRequirements: internship.graduationRequirements,
          stipend: internship.stipend,
          duration: internship.duration,
        })
      );
      const eligibilityResults = verificationResults.map(
        ({ internship, eligibility }) => ({
          internship: structuredInternships.find(
            (candidate) => candidate.sourceUrl === internship.sourceUrl
          ),
          eligibility,
        })
      );
      const matchResults = verificationResults.map(
        ({ internship, eligibility, match }) => ({
          internship: structuredInternships.find(
            (candidate) => candidate.sourceUrl === internship.sourceUrl
          ),
          eligibility,
          match,
        })
      );

      return NextResponse.json(
        {
          message: "Internship search completed successfully.",
          queries: [],
          rawFound: cachedInternships.length,
          results: [],
          communityResults: [],
          totalFound: cachedInternships.length,
          scrapeCandidates: [],
          scrapeCandidateCount: 0,
          scrapedCandidates: [],
          scrapedCount: 0,
          scrapeFailureCount: 0,
          structuredInternships,
          eligibilityResults,
          matchResults,
          verificationResults,
          cacheHit: true,
        },
        { status: 200 }
      );
    }

    const queries = generateSearchQueries(body);
    const searchResults = await Promise.all(
      queries.map(async (query) => {
        try {
          const results = await firecrawl.search(query, { limit: 5 });
          return results.web ?? [];
        } catch {
          return [];
        }
      })
    );

    const uniqueResults = new Map<string, SearchWebResult>();
    for (const results of searchResults) {
      for (const result of results) {
        if (hasUrl(result)) {
          const normalizedUrl = normalizeResultUrl(result.url);
          if (!uniqueResults.has(normalizedUrl)) {
            uniqueResults.set(normalizedUrl, { ...result, url: normalizedUrl });
          }
        }
      }
    }

    const rawResults = await annotatePreviouslyShown([...uniqueResults.values()]);
    const { internshipResults, communityResults } =
      filterSearchResults(rawResults);
    const rankedInternshipResults = deprioritizePreviouslyShown(internshipResults);
    const scrapeCandidates = selectScrapeCandidates(rankedInternshipResults);
    const { scrapedCandidates, scrapeFailureCount } =
      await scrapeSelectedCandidates(scrapeCandidates);
    const structuredInternships = scrapedCandidates.map(
      extractStructuredInternship
    );
    const eligibilityResults = structuredInternships.map((internship) => ({
      internship,
      eligibility: evaluateEligibility(internship, body),
    }));
    const matchResults = eligibilityResults
      .map(({ internship, eligibility }) => ({
        internship,
        eligibility,
        match: calculateMatchScore(internship, eligibility, body),
      }))
      .sort(
        (left, right) =>
          right.match.score - left.match.score ||
          eligibilityStatusRank(right.eligibility.status) -
            eligibilityStatusRank(left.eligibility.status)
      );
    const scrapedContentByUrl = new Map(
      scrapedCandidates.map((candidate) => [candidate.url, candidate.content])
    );
    const freshVerificationResults = matchResults
      .map((item) => ({
        ...item,
        verification: evaluateVerification(
          item.internship,
          scrapedContentByUrl.get(item.internship.sourceUrl) ?? ""
        ),
      }))
      .sort(
        (left, right) =>
          right.match.score - left.match.score ||
          right.verification.score - left.verification.score
      );
    const persistedIds = await persistVerificationResults(freshVerificationResults);
    const freshResultsWithIds = freshVerificationResults.map((item) => ({
      ...item,
      internship: {
        ...item.internship,
        id: persistedIds.get(item.internship.sourceUrl) ?? "",
        internshipId: persistedIds.get(item.internship.sourceUrl) ?? "",
      },
    }));
      const verificationResults = mergeVerificationResults(
      cachedInternships.length > 0
        ? createCachedVerificationResults(cachedInternships, body)
        : [],
      freshResultsWithIds
      );
    await recordShownInternships(rankedInternshipResults);
    return NextResponse.json(
      {
        message: "Internship search completed successfully.",
        queries,
        rawFound: rawResults.length,
        results: rankedInternshipResults,
        communityResults,
        totalFound: rankedInternshipResults.length,
        scrapeCandidates,
        scrapeCandidateCount: scrapeCandidates.length,
        scrapedCandidates,
        scrapedCount: scrapedCandidates.length,
        scrapeFailureCount,
        structuredInternships,
        eligibilityResults,
        matchResults,
        verificationResults,
        cacheHit: false,
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }
}
