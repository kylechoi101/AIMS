import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, Pressable, ScrollView, useColorScheme, ActivityIndicator, Modal, FlatList, Platform } from 'react-native';
import { KeyRound, ShieldCheck, User, HelpCircle } from 'lucide-react-native';
import { useSettingsStore, AiProvider } from '@/lib/store/settingsStore';
import { useAuthStore } from '@/lib/store/authStore';
import Colors from '@/constants/Colors';
import { useRouter } from 'expo-router';
import { TutorialModal } from '@/components/TutorialModal';

const OPENAI_MODELS = ["gpt-5.4-pro", "gpt-5.4-thinking", "gpt-5.4-mini", "gpt-5.2", "gpt-4o"];
const ANTHROPIC_MODELS = ["claude-4.6-opus", "claude-4.6-sonnet", "claude-4.6-haiku", "claude-4.5-sonnet"];
const GEMINI_MODELS = ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-1.0-pro"];

function CustomPicker({ value, onValueChange, options, placeholder, colors }: any) {
  const [modalVisible, setModalVisible] = useState(false);
  return (
    <View style={{ flex: 1 }}>
      <Pressable 
        style={[styles.textInput, { justifyContent: 'center' }]} 
        onPress={() => setModalVisible(true)}
      >
        <Text style={{ color: value ? colors.text : colors.textSecondary }}>
          {value || placeholder}
        </Text>
      </Pressable>

      <Modal visible={modalVisible} transparent animationType="slide">
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={() => setModalVisible(false)} />
        <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '50%', minHeight: 300, position: 'absolute', bottom: 0, left: 0, right: 0 }}>
          <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: colors.text, textAlign: 'center' }}>{placeholder}</Text>
          </View>
          <FlatList
            data={options}
            keyExtractor={(item) => item as string}
            renderItem={({ item }) => (
              <Pressable 
                style={{ padding: 20, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: item === value ? colors.inputBg : 'transparent' }}
                onPress={() => {
                  onValueChange(item);
                  setModalVisible(false);
                }}
              >
                <Text style={{ fontSize: 16, color: colors.text, fontWeight: item === value ? 'bold' : 'normal', textAlign: 'center' }}>
                  {item}
                </Text>
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

export default function SettingsScreen() {
  const { globalApiKey, setGlobalApiKey, setAiProvider, openaiModel, anthropicModel, geminiModel, setModels } = useSettingsStore();
  const { session, updateUserMetadata } = useAuthStore();
  const [displayName, setDisplayName] = useState(session?.user?.user_metadata?.display_name || '');
  const [keyInput, setKeyInput] = useState(globalApiKey);
  
  const [localOpenai, setLocalOpenai] = useState(openaiModel);
  const [localAnthropic, setLocalAnthropic] = useState(anthropicModel);
  const [localGemini, setLocalGemini] = useState(geminiModel);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showTutorial, setShowTutorial] = useState(false);
  
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();

  const handleAuthenticate = async () => {
    setErrorMsg('');
    const token = keyInput.trim();
    if (!token) {
      setErrorMsg('Please enter an API key');
      return;
    }

    setLoading(true);

    if (displayName.trim() && displayName.trim() !== session?.user?.user_metadata?.display_name) {
      await updateUserMetadata(displayName.trim());
    }

    let detectedProvider: AiProvider = 'openai'; 
    
    if (token.startsWith('sk-ant')) {
      detectedProvider = 'anthropic';
    } else if (token.startsWith('AIza')) {
      detectedProvider = 'gemini';
    } else if (token.startsWith('sk-')) {
      detectedProvider = 'openai';
    } else {
      setErrorMsg('Invalid key format. Ensure it starts with sk- or AIza.');
      setLoading(false);
      return;
    }

    try {
      if (detectedProvider === 'openai') {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("OpenAI API Key invalid.");
      } else if (detectedProvider === 'anthropic') {
         const res = await fetch("https://api.anthropic.com/v1/messages", {
           method: "POST",
           headers: { "x-api-key": token, "anthropic-version": "2023-06-01", "content-type": "application/json" },
           body: JSON.stringify({})
         });
         if (res.status === 401) throw new Error("Anthropic API Key invalid.");
      }
      
      setGlobalApiKey(token);
      setAiProvider(detectedProvider);
      setModels(localOpenai.trim() || 'gpt-5.4', localAnthropic.trim() || 'claude-4.6', localGemini.trim() || 'gemini-3.1-pro');
      router.replace('/');
      
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={styles.content}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, marginTop: 16 }}>
        <Text style={[styles.headerTitle, { color: colors.text, marginTop: 0, marginBottom: 0 }]}>Global AI Access</Text>
        <Pressable onPress={() => setShowTutorial(true)} style={{ padding: 4 }}>
           <HelpCircle color={colors.tint} size={24} />
        </Pressable>
      </View>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Drop your API key here. The AIMS system will automatically securely detect if it's OpenAI, Anthropic, or Gemini.
      </Text>

      {errorMsg ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      ) : null}

      <Text style={[styles.label, { color: colors.text }]}>Identity</Text>
      <View style={[styles.inputContainer, { backgroundColor: colors.inputBg, borderColor: colors.border }]}>
        <User size={20} color={colors.textSecondary} style={styles.inputIcon} />
        <TextInput 
          style={[styles.textInput, { color: colors.text }]}
          placeholder="Your Display Name"
          placeholderTextColor={colors.textSecondary}
          value={displayName}
          onChangeText={setDisplayName}
        />
      </View>

      <Text style={[styles.label, { color: colors.text, marginTop: 16 }]}>API Key</Text>
      <View style={[styles.inputContainer, { backgroundColor: colors.inputBg, borderColor: colors.border }]}>
        <KeyRound size={20} color={colors.textSecondary} style={styles.inputIcon} />
        <TextInput 
          style={[styles.textInput, { color: colors.text }]}
          placeholder="sk-..."
          placeholderTextColor={colors.textSecondary}
          secureTextEntry
          value={keyInput}
          onChangeText={setKeyInput}
        />
      </View>

      <Text style={[styles.label, { color: colors.text, marginTop: 16 }]}>Flagship Model Overrides</Text>
      <Text style={{ color: colors.textSecondary, marginBottom: 12, fontSize: 13, marginLeft: 4 }}>
        Select exactly which flagship model version you want the agents to use when you provide that company's API key.
      </Text>
      
      <View style={[styles.inputContainer, { backgroundColor: colors.inputBg, borderColor: colors.border, paddingVertical: Platform.OS === 'ios' ? 0 : 4 }]}>
        <CustomPicker value={localOpenai} onValueChange={setLocalOpenai} options={OPENAI_MODELS} placeholder="Select OpenAI Model..." colors={colors} />
      </View>
      <View style={[styles.inputContainer, { backgroundColor: colors.inputBg, borderColor: colors.border, paddingVertical: Platform.OS === 'ios' ? 0 : 4 }]}>
        <CustomPicker value={localAnthropic} onValueChange={setLocalAnthropic} options={ANTHROPIC_MODELS} placeholder="Select Anthropic Model..." colors={colors} />
      </View>
      <View style={[styles.inputContainer, { backgroundColor: colors.inputBg, borderColor: colors.border, paddingVertical: Platform.OS === 'ios' ? 0 : 4 }]}>
        <CustomPicker value={localGemini} onValueChange={setLocalGemini} options={GEMINI_MODELS} placeholder="Select Gemini Model..." colors={colors} />
      </View>
      
      <Pressable 
        style={[styles.authButton, { backgroundColor: colors.tint }, loading && styles.disabled]}
        disabled={loading}
        onPress={handleAuthenticate}
      >
        {loading ? <ActivityIndicator color="#fff" /> : (
          <>
            <ShieldCheck color="#fff" size={20} style={{ marginRight: 8 }} />
            <Text style={styles.authButtonText}>Authenticate & Proceed</Text>
          </>
        )}
      </Pressable>

      <Text style={[styles.helperText, { color: colors.textSecondary }]}>
        This key is injected strictly into local HTTPS requests from your physical device directly to the LLM networks. Nobody else can see or use it.
      </Text>

      <TutorialModal visible={showTutorial} onClose={() => setShowTutorial(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20 },
  headerTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 8, marginTop: 16 },
  subtitle: { fontSize: 16, marginBottom: 24, lineHeight: 22 },
  label: { fontSize: 16, fontWeight: '600', marginBottom: 8, marginLeft: 4 },
  errorBox: { backgroundColor: '#fee2e2', padding: 12, borderRadius: 8, marginBottom: 16 },
  errorText: { color: '#991b1b', fontSize: 14, textAlign: 'center' },
  inputContainer: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, marginBottom: 16
  },
  inputIcon: { marginRight: 10 },
  textInput: { flex: 1, height: 50, fontSize: 16 },
  authButton: {
    flexDirection: 'row', height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center'
  },
  authButtonText: { color: '#ffffff', fontSize: 16, fontWeight: 'bold' },
  disabled: { opacity: 0.6 },
  helperText: { fontSize: 13, marginTop: 16, lineHeight: 20, textAlign: 'center' }
});
