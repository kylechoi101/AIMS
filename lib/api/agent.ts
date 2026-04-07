import { Message } from "../types";

export type AIProvider = 'openai' | 'anthropic' | 'gemini';

export async function* streamChimeIn(
  provider: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  recentMessages: Message[]
) {
  if (!apiKey) {
    yield "[Error: API key for the selected provider is missing. Please update it in Settings.]";
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    if (provider === 'openai') {
      yield* parseOpenAIStream(apiKey, model, systemPrompt, recentMessages, controller.signal);
    } else if (provider === 'anthropic') {
      yield* parseAnthropicStream(apiKey, model, systemPrompt, recentMessages, controller.signal);
    } else if (provider === 'gemini') {
      yield* parseGeminiStream(apiKey, model, systemPrompt, recentMessages, controller.signal);
    } else {
      yield `[Mock ${provider} streaming response for "${model}"]\n\nI am analyzing this context as a test.`;
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      yield "[Error: The AI provider timed out. Check your connection or API key.]";
    } else {
      yield `[Error: Connection failed. ${err.message}]`;
    }
  } finally {
    clearTimeout(timeoutId);
  }
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
      model: model || "gpt-5.4-mini",
      messages: transformedMessages,
      stream: true
    }),
    signal
  });

  if (!res.ok) throw new Error(`OpenAI Error: ${res.status}`);

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
      model: model || "claude-4.5-haiku",
      max_tokens: 1024,
      system: systemPrompt,
      messages: transformedMessages,
      stream: true
    }),
    signal
  });

  if (!res.ok) throw new Error(`Anthropic Error: ${res.status}`);

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

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-3.1-flash-lite'}:streamGenerateContent?alt=sse&key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: contents.length > 0 ? contents : [{ role: 'user', parts: [{ text: 'Hello' }] }] // Gemini errors on completely empty contents
    }),
    signal
  });

  if (!res.ok) {
     const errorText = await res.text();
     throw new Error(`Gemini Error: ${res.status}. ${errorText}`);
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
          model: "gpt-5.4-mini",
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
          model: "claude-4.5-haiku",
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
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`, {
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
