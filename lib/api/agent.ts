import { Message } from "../types";
import { sortModelsByTier, getModelTier } from "./models";

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
