import type { Internship, ResumeMatchResult } from "@/types/internship";

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9+#.\s-]/g, " ");

export function analyzeResumeMatch(resumeText: string, internship: Internship): ResumeMatchResult {
  const text = normalize(resumeText);
  const skills = (internship.requiredSkills ?? []).filter(Boolean);
  const matchingSkills = skills.filter((skill) => text.includes(normalize(skill).trim()));
  const missingSkills = skills.filter((skill) => !matchingSkills.includes(skill));
  const roleWords = (internship.role ?? "").split(/\s+/).map(normalize).filter((word) => word.length > 3);
  const matchingKeywords = roleWords.filter((word) => text.includes(word));
  const missingKeywords = roleWords.filter((word) => !matchingKeywords.includes(word));
  const relevantExperience = resumeText.split(/[.!?\n]+/).map((line) => line.trim()).filter((line) => line && /(project|intern|experience|built|developed|led)/i.test(line)).slice(0, 5);
  const eligibilityConcerns: string[] = [];
  if (internship.graduationRequirements && !text.includes(normalize(internship.graduationRequirements).slice(0, 20))) eligibilityConcerns.push("Review the internship's education requirements carefully.");
  if (internship.experienceRequired && !text.includes(normalize(internship.experienceRequired).slice(0, 15))) eligibilityConcerns.push("Your resume may not clearly demonstrate the stated experience requirement.");
  const skillScore = skills.length ? (matchingSkills.length / skills.length) * 60 : 30;
  const keywordScore = roleWords.length ? (matchingKeywords.length / roleWords.length) * 25 : 15;
  const experienceScore = relevantExperience.length ? 15 : 0;
  const matchScore = Math.round(Math.min(100, skillScore + keywordScore + experienceScore));
  const recommendation = matchScore >= 80 ? "strong_apply" : matchScore >= 60 ? "apply" : matchScore >= 40 ? "stretch" : "not_recommended";
  const suggestions = [...missingSkills.slice(0, 4).map((skill) => `Highlight or gain experience with ${skill}.`), ...missingKeywords.slice(0, 3).map((word) => `Use the keyword “${word}” if it accurately describes your experience.`)];
  return { matchScore, matchingSkills, missingSkills, matchingKeywords, missingKeywords, relevantExperience, eligibilityConcerns, recommendation, summary: recommendation === "strong_apply" || recommendation === "apply" ? "Good match. Apply and highlight your relevant experience." : "This is a stretch match; address the gaps before applying.", suggestions };
}
