import type { Internship, ResumeMatchResult } from "@/types/internship";

export const copilotTypes = ["good_fit", "cover_letter", "hr_message", "cold_email", "follow_up", "interview_prep", "highlight"] as const;
export type CopilotType = (typeof copilotTypes)[number];

type ResumeContext = { text: string; analysis?: ResumeMatchResult | null };

export function generateCopilotContent(type: CopilotType, internship: Internship, resume: ResumeContext): string {
  const company = internship.company || "the team";
  const role = internship.role || "this internship";
  const skills = resume.analysis?.matchingSkills?.length ? resume.analysis.matchingSkills : internship.requiredSkills ?? [];
  const projects = resume.analysis?.relevantExperience ?? [];
  const skillText = skills.slice(0, 6).join(", ") || "the skills shown in my resume";
  const projectText = projects.slice(0, 2).join(" ") || "my relevant academic and project experience";
  const requirements = internship.description || internship.experienceRequired || "the responsibilities described in the posting";
  switch (type) {
    case "good_fit": return `Why I'm a good fit for ${role} at ${company}\n\nMy resume shows ${skillText}. Relevant evidence includes: ${projectText}\n\nThese strengths connect directly with ${requirements.slice(0, 300)}.`;
    case "cover_letter": return `Dear ${company} Hiring Team,\n\nI am excited to apply for the ${role} opportunity. My experience with ${skillText} and the work described in my resume, including ${projectText}, aligns with the needs of this internship.\n\nI would welcome the opportunity to discuss how I can contribute while continuing to learn from your team. Thank you for your consideration.\n\nSincerely,\n[Your Name]`;
    case "hr_message": return `Hi ${company} team, I’m interested in the ${role} internship. My background includes ${skillText}, with relevant work such as ${projectText}. I’d appreciate the opportunity to learn more. Thank you!`;
    case "cold_email": return `Subject: Application for ${role} internship\n\nHello ${company} team,\n\nI’m reaching out about the ${role} internship. My resume highlights ${skillText} and ${projectText}. I would be grateful if you could consider my application or direct me to the appropriate process.\n\nBest,\n[Your Name]`;
    case "follow_up": return `Subject: Following up — ${role} internship\n\nHello ${company} team,\n\nI wanted to politely follow up on my application for the ${role} internship. I remain very interested and would be happy to provide any additional information.\n\nBest,\n[Your Name]`;
    case "interview_prep": return [`What interests you about ${role}?`, `How have you used ${skillText}?`, `Tell us about ${projectText}.`, `How would you approach a task described in this internship posting?`, `What would you like to learn during this internship?`, `Describe a technical challenge you faced and how you approached it.`].join("\n\n");
    case "highlight": return `Skills to highlight: ${skillText}\n\nRelevant resume evidence:\n${projects.map((project) => `- ${project}`).join("\n") || "- Use specific projects or coursework already present in your resume."}`;
  }
}
