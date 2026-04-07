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
  setAiProvider: (provider: AiProvider) => void;
  setGlobalApiKey: (key: string) => void;
  setModels: (openai: string, anthropic: string, gemini: string) => void;
}

export const useSettingsStore = create<SettingsSlice>((set) => ({
  aiProvider: (storage.getString('aiProvider') as AiProvider) || 'openai',
  globalApiKey: storage.getString('globalApiKey') || '',
  openaiModel: storage.getString('openaiModel') || 'gpt-5.4-pro',
  anthropicModel: storage.getString('anthropicModel') || 'claude-4.6-opus',
  geminiModel: storage.getString('geminiModel') || 'gemini-3.1-pro',
  
  setAiProvider: (provider: AiProvider) => {
    storage.set('aiProvider', provider);
    set({ aiProvider: provider });
  },

  setGlobalApiKey: (key: string) => {
    storage.set('globalApiKey', key);
    set({ globalApiKey: key });
  },

  setModels: (openai: string, anthropic: string, gemini: string) => {
    storage.set('openaiModel', openai);
    storage.set('anthropicModel', anthropic);
    storage.set('geminiModel', gemini);
    set({ openaiModel: openai, anthropicModel: anthropic, geminiModel: gemini });
  }
}));
