import { AiProvider } from '../store/settingsStore';

export type ModelTier = 'flagship' | 'mid' | 'light';

export function getModelTier(model: string): ModelTier {
  const lower = model.toLowerCase();

  // OpenAI: opus/4/pro are flagship, mini/small are light
  if (lower.includes('gpt-4o')) {
    if (lower.includes('mini')) return 'light';
    return 'flagship';
  }
  if (lower.includes('o1') || lower.includes('o3')) return 'flagship';
  if (lower.includes('gpt-4')) {
    if (lower.includes('turbo')) return 'flagship';
    return 'mid';
  }

  // Claude: opus/4.6 are flagship, haiku/3 are light
  if (lower.includes('opus')) return 'flagship';
  if (lower.includes('sonnet') || lower.includes('4.5') || lower.includes('4.6')) return 'mid';
  if (lower.includes('haiku') || lower.includes('3.')) return 'light';

  // Gemini: flash is always light (check before version), pro are flagship
  if (lower.includes('flash')) return 'light';
  if (lower.includes('pro')) return 'flagship';
  if (lower.includes('gemini-2')) return 'mid';
  if (lower.includes('gemini-1')) return 'light';

  return 'mid'; // default
}

export function sortModelsByTier(models: string[]): { flagship: string[], mid: string[], light: string[] } {
  const tiers = { flagship: [] as string[], mid: [] as string[], light: [] as string[] };
  models.forEach(m => {
    const tier = getModelTier(m);
    tiers[tier].push(m);
  });
  return tiers;
}

export async function fetchAvailableModels(provider: AiProvider, apiKey: string): Promise<string[]> {
  try {
    if (provider === 'openai') return await fetchOpenAIModels(apiKey);
    if (provider === 'gemini') return await fetchGeminiModels(apiKey);
    if (provider === 'anthropic') return await fetchAnthropicModels(apiKey);
    return [];
  } catch {
    return [];
  }
}

async function fetchOpenAIModels(apiKey: string): Promise<string[]> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { "Authorization": `Bearer ${apiKey}` }
  });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.data || [])
    .map((m: any) => m.id as string)
    .filter((id: string) => /^(gpt-|o[1-9]|chatgpt-)/.test(id))
    .filter((id: string) => !id.includes('realtime') && !id.includes('audio') && !id.includes('tts') && !id.includes('dall-e') && !id.includes('whisper') && !id.includes('embedding'))
    .sort()
    .reverse();
}

async function fetchGeminiModels(apiKey: string): Promise<string[]> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  if (!res.ok) return [];
  const json = await res.json();
  return (json.models || [])
    .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent') || m.supportedGenerationMethods?.includes('streamGenerateContent'))
    .map((m: any) => (m.name || '').replace('models/', ''))
    .filter((id: string) => id.includes('gemini'))
    .sort()
    .reverse();
}

async function fetchAnthropicModels(apiKey: string): Promise<string[]> {
  // Try the models endpoint first (may exist in newer API versions)
  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      }
    });
    if (res.ok) {
      const json = await res.json();
      if (json.data && Array.isArray(json.data)) {
        return json.data
          .map((m: any) => m.id as string)
          .filter((id: string) => id.includes('claude'))
          .sort()
          .reverse();
      }
    }
  } catch {}

  // Fallback: known model IDs (real API identifiers)
  return [
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
    "claude-sonnet-4-5-20250514",
    "claude-3-5-sonnet-20241022",
    "claude-3-haiku-20240307",
  ];
}
