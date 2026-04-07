import { create } from "zustand";
import { Platform } from "react-native";
import { createMMKV } from "react-native-mmkv";

// Safe MMKV initialization — falls back gracefully if native module isn't ready
const webStorage = {
  set: (k: string, v: string) => typeof window !== 'undefined' && window.localStorage.setItem(k, v),
  getString: (k: string) => typeof window !== 'undefined' ? window.localStorage.getItem(k) : null,
  remove: (k: string) => typeof window !== 'undefined' && window.localStorage.removeItem(k)
};

let storage: any;
if (Platform.OS === 'web') {
  storage = webStorage;
} else {
  try {
    storage = createMMKV({ id: 'settings-store' });
  } catch (e) {
    console.warn('MMKV init failed, using in-memory fallback:', e);
    const memStore: Record<string, string> = {};
    storage = {
      set: (k: string, v: string) => { memStore[k] = v; },
      getString: (k: string) => memStore[k] ?? null,
      remove: (k: string) => { delete memStore[k]; }
    };
  }
}

export type AiProvider = 'openai' | 'anthropic' | 'gemini';

interface SettingsSlice {
  aiProvider: AiProvider;
  globalApiKey: string;
  openaiModel: string;
  anthropicModel: string;
  geminiModel: string;
  availableOpenaiModels: string[];
  availableAnthropicModels: string[];
  availableGeminiModels: string[];
  keyValidated: boolean;
  setAiProvider: (provider: AiProvider) => void;
  setGlobalApiKey: (key: string) => void;
  setModels: (openai: string, anthropic: string, gemini: string) => void;
  setAvailableModels: (provider: AiProvider, models: string[]) => void;
  setKeyValidated: (validated: boolean) => void;
  getActiveModel: () => string;
  getAvailableModelsForActiveProvider: () => string[];
}

// Load cached available models from MMKV
function loadCachedModels(provider: string): string[] {
  const cached = storage.getString(`availableModels_${provider}`);
  if (cached) {
    try { return JSON.parse(cached); } catch {}
  }
  return [];
}

export const useSettingsStore = create<SettingsSlice>((set) => ({
  aiProvider: (storage.getString('aiProvider') as AiProvider) || 'openai',
  globalApiKey: storage.getString('globalApiKey') || '',
  openaiModel: storage.getString('openaiModel') || '',
  anthropicModel: storage.getString('anthropicModel') || '',
  geminiModel: storage.getString('geminiModel') || '',
  availableOpenaiModels: loadCachedModels('openai'),
  availableAnthropicModels: loadCachedModels('anthropic'),
  availableGeminiModels: loadCachedModels('gemini'),
  keyValidated: !!storage.getString('globalApiKey'),

  setAiProvider: (provider: AiProvider) => {
    storage.set('aiProvider', provider);
    set({ aiProvider: provider });
  },

  setGlobalApiKey: (key: string) => {
    storage.set('globalApiKey', key);
    set({ globalApiKey: key });
  },

  setModels: (openai: string, anthropic: string, gemini: string) => {
    const current = useSettingsStore.getState();
    const finalOpenai = openai || current.openaiModel;
    const finalAnthropic = anthropic || current.anthropicModel;
    const finalGemini = gemini || current.geminiModel;
    if (finalOpenai) storage.set('openaiModel', finalOpenai);
    if (finalAnthropic) storage.set('anthropicModel', finalAnthropic);
    if (finalGemini) storage.set('geminiModel', finalGemini);
    set({ openaiModel: finalOpenai, anthropicModel: finalAnthropic, geminiModel: finalGemini });
  },

  setAvailableModels: (provider: AiProvider, models: string[]) => {
    storage.set(`availableModels_${provider}`, JSON.stringify(models));
    if (provider === 'openai') set({ availableOpenaiModels: models });
    else if (provider === 'anthropic') set({ availableAnthropicModels: models });
    else if (provider === 'gemini') set({ availableGeminiModels: models });
  },

  setKeyValidated: (validated: boolean) => {
    set({ keyValidated: validated });
  },

  getActiveModel: () => {
    const state = useSettingsStore.getState();
    const provider = state.aiProvider;
    if (provider === 'openai') return state.openaiModel;
    if (provider === 'anthropic') return state.anthropicModel;
    return state.geminiModel;
  },

  getAvailableModelsForActiveProvider: () => {
    const state = useSettingsStore.getState();
    const provider = state.aiProvider;
    if (provider === 'openai') return state.availableOpenaiModels;
    if (provider === 'anthropic') return state.availableAnthropicModels;
    return state.availableGeminiModels;
  }
}));
