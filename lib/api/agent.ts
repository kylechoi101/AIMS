import { Message, Pass1Result } from "../types";
import { sortModelsByTier, getModelTier } from "./models";
import { buildPass1Prompt, parsePass1Response, buildPass2Prompt, FIVE_LAYER_PROMPTS, buildMetadataPrompt } from "../../services/agent-dispatch";

export type AIProvider = 'openai' | 'anthropic' | 'gemini';

export async function* streamChimeIn(
  provider: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  recentMessages: Message[],
  availableModels?: string[],
  onFallback?: (fromModel: string, toModel: string) => void
) {
  if (!apiKey) {
    yield "[Error: API key for the selected provider is missing. Please update it in Settings.]";
    return;
  }

  // Build fallback chain: flagship → mid → light
  const fallbackChain = availableModels
    ? buildFallbackChain(availableModels, model)
    : [model];

  for (let i = 0; i < fallbackChain.length; i++) {
    const tryModel = fallbackChain[i];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      if (provider === 'openai') {
        yield* parseOpenAIStream(apiKey, tryModel, systemPrompt, recentMessages, controller.signal);
      } else if (provider === 'anthropic') {
        yield* parseAnthropicStream(apiKey, tryModel, systemPrompt, recentMessages, controller.signal);
      } else if (provider === 'gemini') {
        yield* parseGeminiStream(apiKey, tryModel, systemPrompt, recentMessages, controller.signal);
      } else {
        yield `[Mock ${provider} streaming response for "${tryModel}"]\n\nI am analyzing this context as a test.`;
      }
      clearTimeout(timeoutId);
      return; // Success — stop retrying
    } catch (err: any) {
      clearTimeout(timeoutId);

      const isQuotaError = err.status === 402 || err.status === 429;
      const shouldRetry = isQuotaError && i < fallbackChain.length - 1;

      if (shouldRetry) {
        const nextModel = fallbackChain[i + 1];
        if (onFallback) {
          onFallback(tryModel, nextModel);
        }
        yield `[Switching from ${tryModel} to ${nextModel} due to quota limits...]\n\n`;
        continue; // Try next tier
      }

      // No more fallbacks or non-quota error
      if (err.name === 'AbortError') {
        yield "[Error: The AI provider timed out. Check your connection or API key.]";
      } else if (err.status === 401) {
        yield "[Error: Invalid or expired API key. Update it in Settings.]";
      } else {
        yield `[Error: ${err.message || 'Connection failed'}]`;
      }
      return;
    }
  }
}

function buildFallbackChain(availableModels: string[], preferredModel: string): string[] {
  // If preferred model not available, start from best available
  if (!availableModels.includes(preferredModel) && availableModels.length > 0) {
    preferredModel = availableModels[0];
  }

  // Sort by tier, preferred first within its tier
  const tiers = sortModelsByTier(availableModels);
  const preferredTier = getModelTier(preferredModel);

  // Build chain: preferred tier (preferred first), then other tiers in order
  const chain: string[] = [];

  // Always degrade downward: flagship → mid → light
  if (preferredTier === 'flagship' && tiers.flagship.length > 0) {
    chain.push(preferredModel, ...tiers.flagship.filter(m => m !== preferredModel));
    chain.push(...tiers.mid, ...tiers.light);
  } else if (preferredTier === 'mid' && tiers.mid.length > 0) {
    chain.push(preferredModel, ...tiers.mid.filter(m => m !== preferredModel));
    chain.push(...tiers.light);
  } else if (preferredTier === 'light' && tiers.light.length > 0) {
    chain.push(preferredModel, ...tiers.light.filter(m => m !== preferredModel));
  } else {
    chain.push(...tiers.flagship, ...tiers.mid, ...tiers.light);
  }

  return chain.length > 0 ? chain : [preferredModel];
}

async function* parseOpenAIStream(apiKey: string, model: string, systemPrompt: string, messages: Message[], signal: AbortSignal) {
  const transformedMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({
      role: m.sender_type === 'user' ? 'user' : 'assistant',
      content: m.content
    }))
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || "gpt-4o-mini",
      messages: transformedMessages,
      stream: true
    }),
    signal
  });

  if (!res.ok) {
    const err: any = new Error(`OpenAI Error: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No readable stream available.");

  const decoder = new TextDecoder("utf-8");
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });

    // Server Sent Events processing
    const lines = chunk.split('\n').filter(line => line.trim() !== '');
    for (const line of lines) {
      if (line.replace('data: ', '').trim() === '[DONE]') return;
      if (line.startsWith('data: ')) {
        try {
           const parsed = JSON.parse(line.substring(6));
           if (parsed.choices?.[0]?.delta?.content) {
             yield parsed.choices[0].delta.content;
           }
        } catch(e) {}
      }
    }
  }
}

async function* parseAnthropicStream(apiKey: string, model: string, systemPrompt: string, messages: Message[], signal: AbortSignal) {
  const transformedMessages = messages.map(m => ({
    role: m.sender_type === 'user' ? 'user' : 'assistant',
    content: m.content
  }));

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: model || "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemPrompt,
      messages: transformedMessages,
      stream: true
    }),
    signal
  });

  if (!res.ok) {
    const err: any = new Error(`Anthropic Error: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No readable stream available.");

  const decoder = new TextDecoder("utf-8");
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });

    const lines = chunk.split('\n').filter(line => line.trim() !== '');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
           const parsed = JSON.parse(line.substring(6));
           if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
             yield parsed.delta.text;
           }
        } catch(e) {}
      }
    }
  }
}

async function* parseGeminiStream(apiKey: string, model: string, systemPrompt: string, messages: Message[], signal: AbortSignal) {
  const contents = messages.map(m => ({
    role: m.sender_type === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }]
  }));

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.0-flash'}:streamGenerateContent?alt=sse&key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: contents.length > 0 ? contents : [{ role: 'user', parts: [{ text: 'Hello' }] }]
    }),
    signal
  });

  if (!res.ok) {
    const err: any = new Error(`Gemini Error: ${res.status}`);
    err.status = res.status;
    const errorText = await res.text();
    err.message = `${err.message}. ${errorText}`;
    throw err;
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No readable stream available.");

  const decoder = new TextDecoder("utf-8");
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });

    const lines = chunk.split('\n').filter(line => line.trim() !== '');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
           const parsed = JSON.parse(line.substring(6));
           if (parsed.candidates?.[0]?.content?.parts?.[0]?.text) {
             yield parsed.candidates[0].content.parts[0].text;
           }
        } catch(e) {}
      }
    }
  }
}

/**
 * Non-streaming call to a single model. No fallback chain.
 * Used for Pass 1 analysis and five-layer pipeline steps.
 */
export async function callModelDirect(
  provider: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: Message[],
  timeoutMs: number = 12000
): Promise<string> {
  let result = "";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (provider === 'openai') {
      for await (const chunk of parseOpenAIStream(apiKey, model, systemPrompt, messages, controller.signal)) {
        result += chunk;
      }
    } else if (provider === 'anthropic') {
      for await (const chunk of parseAnthropicStream(apiKey, model, systemPrompt, messages, controller.signal)) {
        result += chunk;
      }
    } else if (provider === 'gemini') {
      for await (const chunk of parseGeminiStream(apiKey, model, systemPrompt, messages, controller.signal)) {
        result += chunk;
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }

  return result;
}

/** Get the best available light model. */
export function getLightModel(availableModels: string[]): string | null {
  const tiers = sortModelsByTier(availableModels);
  return tiers.light[0] || tiers.mid[0] || null;
}

/** Get the best available flagship model. */
export function getFlagshipModel(availableModels: string[]): string | null {
  const tiers = sortModelsByTier(availableModels);
  return tiers.flagship[0] || tiers.mid[0] || null;
}

/**
 * Five-Layer Fallback Pipeline.
 * Achieves flagship-quality analysis through chained light model calls.
 * Layers: Analyzer -> Role Inventor -> Prompt Writer -> (Responder is external) -> (Overseer on regen)
 */
export async function runFiveLayerAnalysis(
  provider: string,
  apiKey: string,
  lightModel: string,
  recentMessages: Message[],
): Promise<Pass1Result> {
  const chatLog = recentMessages
    .slice(-20)
    .map(m => `[${m.sender_name || m.sender_type}]: ${m.content}`)
    .join('\n');

  const dummyMsg: Message[] = [{
    id: 'pipeline', room_id: '', sender_id: null, sender_type: 'user',
    content: 'Proceed.', created_at: new Date().toISOString()
  }];

  try {
    // Layer 1: Analyzer — extract facts, decisions, open questions
    const analysis = await callModelDirect(provider, apiKey, lightModel, FIVE_LAYER_PROMPTS.analyzer(chatLog), dummyMsg, 10000);

    // Layer 2: Role + Argument — invent expert role AND the numbered argument structure
    const roleArgRaw = await callModelDirect(provider, apiKey, lightModel, FIVE_LAYER_PROMPTS.roleAndArgument(analysis), dummyMsg, 10000);

    let role = 'Strategic Advisor';
    let args = '';
    try {
      const match = roleArgRaw.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        role = parsed.role || role;
        args = Array.isArray(parsed.arguments) ? parsed.arguments.join('\n') : String(parsed.arguments || '');
      }
    } catch {}

    // Layer 3: Blueprint Writer — expand into full execution blueprint
    const blueprint = await callModelDirect(provider, apiKey, lightModel, FIVE_LAYER_PROMPTS.blueprintWriter(role, args, analysis), dummyMsg, 10000);

    return { role, blueprint };
  } catch {
    return {
      role: 'Advisor',
      blueprint: 'PERSONA: You are a direct, helpful advisor.\n\nSITUATION ASSESSMENT: The conversation needs constructive input.\n\nARGUMENT STRUCTURE:\n1. Address the most recent point raised with a specific opinion\n2. Offer one concrete, actionable suggestion\n3. Flag one risk or blind spot\n\nTONE: Direct and specific. No hedging.\n\nFORMAT: Short paragraphs. End with a clear next step.\n\nMUST AVOID: Vague advice. Repeating what was already said.',
    };
  }
}

/**
 * Extract structured metadata from conversation for room details.
 * Non-blocking — fire-and-forget.
 */
export async function extractMetadata(
  provider: string,
  apiKey: string,
  model: string,
  recentMessages: Message[],
): Promise<Record<string, any> | null> {
  const chatLog = recentMessages
    .slice(-30)
    .map(m => `[${m.sender_name || m.sender_type}]: ${m.content}`)
    .join('\n');

  const dummyMsg: Message[] = [{
    id: 'meta', room_id: '', sender_id: null, sender_type: 'user',
    content: 'Extract the metadata.', created_at: new Date().toISOString()
  }];

  try {
    const raw = await callModelDirect(provider, apiKey, model, buildMetadataPrompt(chatLog), dummyMsg, 10000);
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}
  return null;
}

export async function generateRoomTitle(
  provider: string,
  apiKey: string,
  messages: Message[]
): Promise<string | null> {
  if (!apiKey) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  const prompt = "Analyze this chat log. Reply with exactly 2 to 4 words representing the core topic summarized. No quotes. No punctuation.";
  const chatLog = messages.slice(-5).map(m => m.content).join('\n');

  try {
    if (provider === 'openai') {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: 'system', content: prompt }, { role: 'user', content: chatLog }],
          stream: false
        }),
        signal: controller.signal
      });
      const json = await res.json();
      return json.choices?.[0]?.message?.content?.replace(/['"]/g, '').trim() || null;

    } else if (provider === 'anthropic') {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 30,
          system: prompt,
          messages: [{ role: 'user', content: chatLog || "Empty brainstorm session" }],
          stream: false
        }),
        signal: controller.signal
      });
      const json = await res.json();
      return json.content?.[0]?.text?.replace(/['"]/g, '').trim() || null;

    } else if (provider === 'gemini') {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: prompt }] },
          contents: [{ role: 'user', parts: [{ text: chatLog || "Empty brainstorm session" }] }]
        }),
        signal: controller.signal
      });
      if (!res.ok) return null;
      const json = await res.json();
      return json.candidates?.[0]?.content?.parts?.[0]?.text?.replace(/['"\n]/g, '').trim() || null;
    }
  } catch(e) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
  return null;
}
