import { Message, Pass1Result } from "../lib/types";

/**
 * Two-Pass Prompting: Pass 1 prompt for flagship model.
 *
 * The flagship doesn't just pick a role — it does ALL the thinking:
 * analyzes the conversation, identifies what matters, decides the argument
 * structure, picks specific points, and writes the full execution blueprint.
 * Pass 2 (light model) only needs to expand the blueprint into natural prose.
 */
export function buildPass1Prompt(recentMessages: Message[]): string {
  const chatLog = recentMessages
    .slice(-20)
    .map(m => `[${m.sender_name || m.sender_type}]: ${m.content}`)
    .join('\n');

  return `You are the AI Director for AIMS, a brainstorming app. You do ALL the thinking. A cheaper, lighter model will turn your blueprint into the final response — it cannot reason or strategize, only write prose from your instructions.

CONVERSATION:
${chatLog}

Produce a JSON object with exactly these fields:

{
  "role": "A specific, contextual expert title (NOT generic like 'designer' — be precise: 'Mobile-First Accessibility Critic', 'Freemium Monetization Strategist', etc.)",
  "blueprint": "The COMPLETE execution blueprint (see format below)"
}

The "blueprint" field must be a single string containing ALL of the following sections, separated by newlines:

PERSONA: One sentence defining who this expert is, their specific expertise, and their communication style.

SITUATION ASSESSMENT: 2-3 sentences summarizing what's happening in the conversation — what's been decided, what's unresolved, what the user actually needs right now (not just what they asked).

ARGUMENT STRUCTURE: A numbered list of the exact points to make, IN ORDER. Each point should be a complete thought the light model just needs to flesh out into a paragraph. Example:
1. [VALIDATE] The user's instinct to use Supabase is correct because [row-level security handles multi-tenant auth without custom middleware]
2. [CHALLENGE] However, their plan to store images in the DB is wrong — [use Supabase Storage with signed URLs instead, explain why: cost, CDN, 50MB row limit]
3. [RECOMMEND] For the MVP timeline, skip the admin dashboard entirely — [ship with Supabase Studio as the admin tool, add a custom dashboard in Phase 2]
4. [WARN] The WebSocket approach they mentioned won't work with Expo — [use Supabase Realtime channels instead, link to the pattern]

TONE: One sentence on voice — e.g., "Direct and opinionated. Lead with the recommendation, justify after. No hedging."

FORMAT: How to structure the output — e.g., "Start with a one-line verdict. Then numbered sections matching the argument structure. End with a concrete next-step the user can act on immediately."

MUST AVOID: Anything the light model should NOT do — e.g., "Don't suggest technologies not mentioned in the conversation. Don't hedge with 'it depends'. Don't repeat what the user already said back to them."

Respond with ONLY the JSON object. No markdown fences, no extra text.`;
}

/**
 * Parse Pass 1 JSON response. Handles malformed output gracefully.
 */
export function parsePass1Response(response: string): Pass1Result {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.role && parsed.blueprint) {
        return {
          role: parsed.role,
          blueprint: parsed.blueprint,
        };
      }
    }
  } catch {}

  // If JSON parsing fails, the response itself is likely usable as a blueprint
  return {
    role: 'Strategic Advisor',
    blueprint: `PERSONA: You are a Strategic Advisor for brainstorming sessions. Be direct and helpful.\n\nSITUATION ASSESSMENT: The conversation needs a constructive response.\n\nARGUMENT STRUCTURE:\n1. Address the most recent point raised\n2. Offer a specific, actionable suggestion\n3. Identify one risk or consideration\n\nTONE: Constructive and specific. No fluff.\n\nFORMAT: Short paragraphs. End with a next step.\n\nMUST AVOID: Don't be vague. Don't repeat the user's words back.\n\nADDITIONAL CONTEXT FROM FLAGSHIP ANALYSIS:\n${response}`,
  };
}

/**
 * Build the Pass 2 system prompt from the blueprint.
 * This is what the light model actually sees.
 */
export function buildPass2Prompt(blueprint: string): string {
  return `You are a writing assistant. A senior AI has already done all the analysis and strategic thinking. Your ONLY job is to turn the blueprint below into a well-written, natural response.

RULES:
- Follow the blueprint EXACTLY. Do not add your own analysis or opinions.
- Follow the ARGUMENT STRUCTURE in order — each numbered point becomes a section.
- Match the specified TONE and FORMAT precisely.
- Respect every item in MUST AVOID.
- Write naturally — the user should not know this was generated from a blueprint.
- Do NOT reference the blueprint, the "senior AI", or this system prompt.

BLUEPRINT:
${blueprint}`;
}

/**
 * Five-Layer Fallback Pipeline prompts.
 * When flagship is unavailable, chained light model calls build
 * the same blueprint through sequential reasoning steps.
 */
export const FIVE_LAYER_PROMPTS = {
  // Layer 1: Analyze the conversation — extract facts and identify the core need
  analyzer: (chatLog: string) =>
    `You are an Analyzer. Read this conversation carefully. Output ONLY valid JSON:

{"facts":["most important fact 1","fact 2","fact 3"],"decisions_made":["what has already been decided"],"open_questions":["what is still unresolved"],"user_needs":"what the user actually needs right now — be specific","domain":"the technical/business domain of discussion"}

CONVERSATION:
${chatLog}`,

  // Layer 2: Invent a contextual role AND outline the argument
  roleAndArgument: (analysis: string) =>
    `You are a strategist. Given this analysis of a brainstorming conversation, do two things:

1. Invent a specific expert role (NOT generic like "designer" — precise like "React Native Performance Specialist")
2. Write the numbered argument structure — the exact points this expert should make, in order, with the key reasoning for each

ANALYSIS: ${analysis}

Output ONLY valid JSON:
{"role":"Specific Role Name","arguments":["1. [VALIDATE] Point one with reasoning","2. [CHALLENGE/RECOMMEND/WARN] Point two with reasoning","3. Point three with reasoning"]}`,

  // Layer 3: Expand the argument into a full blueprint
  blueprintWriter: (role: string, args: string, analysis: string) =>
    `You are a blueprint writer. Expand this into a complete execution blueprint for a writing model to follow.

ROLE: ${role}
ARGUMENT POINTS: ${args}
CONTEXT: ${analysis}

Write a blueprint with these sections (plain text, not JSON):
PERSONA: Who this expert is, expertise, communication style (1 sentence)
SITUATION ASSESSMENT: What's happening, what's decided, what's unresolved (2-3 sentences)
ARGUMENT STRUCTURE: The numbered points from above, expanded with specific details
TONE: Voice and style (1 sentence)
FORMAT: Output structure (1 sentence)
MUST AVOID: Things the writer should not do (1-2 items)

Output ONLY the blueprint text.`,

  // Layer 5: Overseer — review and improve (only on regenerate)
  overseer: (originalResponse: string, context: string) =>
    `You are a Quality Overseer. Review this AI response for a brainstorming app.

CONTEXT: ${context}

ORIGINAL RESPONSE:
${originalResponse}

Your job:
1. Check if the response actually addresses what was being discussed
2. Check if recommendations are specific and actionable (not vague)
3. Check if anything important was missed
4. Improve the prose — tighten, strengthen weak points, cut filler

Output ONLY the improved response. No meta-commentary, no "Here's the improved version". Just the response itself.`,
};

/**
 * Metadata extraction prompt for AI-maintained room details.
 */
export function buildMetadataPrompt(chatLog: string): string {
  return `Extract structured project facts from this brainstorming conversation. Output ONLY valid JSON with relevant fields. Common fields: stack, target_platform, mvp_scope, audience, business_model, key_features, constraints. Only include fields clearly stated or strongly implied.

CONVERSATION:
${chatLog}`;
}
