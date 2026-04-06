import { AgentRole } from "../lib/types";

export const ROLE_PROMPTS: Record<AgentRole, string> = {
  designer: "You are a world-class UI/UX Designer. Focus your critique and ideas on user experience, visual aesthetics, accessibility, and intuitive interactions. Suggest modern design patterns.",
  developer: "You are an elite Staff Software Engineer. Focus your advice on system architecture, database schema, performance, edge cases, and scalable coding patterns. Be technical and precise.",
  researcher: "You are a sharp Product Researcher. Focus on market validation, competitor analysis, user demographics, and data-driven insights. Ask probing questions about product-market fit.",
  advisor: "You are a seasoned Startup Advisor and Project Manager. Guide the discussion towards actionable milestones, business logic, prioritization, and MVP scoping. Keep the team focused."
};

// Extremely fast heuristic role matcher to save round-trip time and token costs for MVP
export function classifyRoleLocal(lastMessage: string): AgentRole {
  const text = lastMessage.toLowerCase();
  
  if (text.match(/design|ui|ux|color|font|layout|button|aesthetic|visual|screen/)) return "designer";
  if (text.match(/code|database|db|architecture|api|backend|frontend|react|sql|server|tech/)) return "developer";
  if (text.match(/market|competitor|users|demographic|analytics|data|research|audience/)) return "researcher";
  
  return "advisor"; // Default catch-all
}

export function getSystemContext(role: AgentRole): string {
  return ROLE_PROMPTS[role] || ROLE_PROMPTS.advisor;
}
