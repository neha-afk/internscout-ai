import { describe, expect, it } from "vitest";
import { applyDomainCap, deprioritizePreviouslyShown, extractCompanyAndRole, freshnessRank, normalizeResultUrl } from "../app/api/search/route";

const result = (url: string, title = "Software Engineering Intern") => ({ url, title, description: "internship", sourcePriority: 100 });

describe("discovery quality", () => {
  it("caps Lever results in the top ten", () => {
    const input = [...Array.from({ length: 8 }, (_, i) => result(`https://jobs.lever.co/a/${i}`)), result("https://boards.greenhouse.io/a/1"), result("https://company.example/jobs/1")];
    const top = applyDomainCap(input).slice(0, 10);
    expect(top.filter((item) => item.url.includes("lever.co")).length).toBeLessThanOrEqual(3);
  });
  it("normalizes URLs for tracking and trailing slash differences", () => {
    expect(normalizeResultUrl("http://example.com/job/?utm_source=x#apply")).toBe("https://example.com/job");
  });
  it("keeps dated freshness above unknown", () => {
    expect(freshnessRank("dated")).toBeGreaterThan(freshnessRank("unknown"));
  });
  it("deprioritizes shown results without removing them", () => {
    const output = deprioritizePreviouslyShown([{ id: "seen", is_previously_seen: true }, { id: "new", is_previously_seen: false }]);
    expect(output.map((item) => item.id)).toEqual(["new", "seen"]);
    expect(output).toHaveLength(2);
  });

  it("derives companies from supported ATS URL patterns", () => {
    expect(extractCompanyAndRole("Software Engineering Intern", "https://jobs.lever.co/acme/123").company).toBe("Acme");
    expect(extractCompanyAndRole("Software Engineering Intern", "https://boards.greenhouse.io/acme/jobs/123").company).toBe("Acme");
    expect(extractCompanyAndRole("Software Engineering Intern", "https://jobs.ashbyhq.com/acme/123").company).toBe("Acme");
  });

  it("uses title company format and leaves unresolvable companies null", () => {
    expect(extractCompanyAndRole("Acme - Software Engineering Intern", "https://example.com/jobs/123").company).toBe("Acme");
    expect(extractCompanyAndRole("Software Engineering Intern", "https://www.glassdoor.co.in/Job/SRCH_123").company).toBeNull();
    expect(extractCompanyAndRole("Software Engineering Intern", "https://databricks.com/careers/jobs/123").company).toBe("Databricks");
  });
});
