import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView, useColorScheme, ActivityIndicator, Modal, FlatList, Platform } from 'react-native';
import { KeyRound, ShieldCheck, User, HelpCircle, CheckCircle, AlertCircle } from 'lucide-react-native';
import { useSettingsStore, AiProvider } from '@/lib/store/settingsStore';
import { useAuthStore } from '@/lib/store/authStore';
import { fetchAvailableModels } from '@/lib/api/models';
import Colors from '@/constants/Colors';
import { useRouter } from 'expo-router';
import { TutorialModal } from '@/components/TutorialModal';

function CustomPicker({ value, onValueChange, options, placeholder, colors, allowCustom }: any) {
  const [modalVisible, setModalVisible] = useState(false);
  const [customInput, setCustomInput] = useState('');

  const displayOptions = allowCustom ? [...options, '__custom__'] : options;

  return (
    <View style={{ flex: 1 }}>
      <TouchableOpacity
        style={[styles.textInput, { justifyContent: 'center' }]}
        onPress={() => setModalVisible(true)}
        activeOpacity={0.6}
      >
        <Text style={{ color: value ? colors.text : colors.textSecondary }}>
          {value || placeholder}
        </Text>
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="slide">
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={() => setModalVisible(false)} activeOpacity={1} />
        <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '50%', minHeight: 300, position: 'absolute', bottom: 0, left: 0, right: 0 }}>
          <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: colors.text, textAlign: 'center' }}>{placeholder}</Text>
          </View>
          {options.length === 0 ? (
            <View style={{ padding: 20, alignItems: 'center' }}>
              <Text style={{ color: colors.textSecondary, fontSize: 14 }}>No models loaded yet. Authenticate your API key first.</Text>
            </View>
          ) : null}
          <FlatList
            data={displayOptions}
            keyExtractor={(item) => item as string}
            renderItem={({ item }) => {
              if (item === '__custom__') {
                return (
                  <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center' }}>
                    <TextInput
                      style={{ flex: 1, fontSize: 16, color: colors.text, height: 40 }}
                      placeholder="Type custom model ID..."
                      placeholderTextColor={colors.textSecondary}
                      value={customInput}
                      onChangeText={setCustomInput}
                      autoCapitalize="none"
                    />
                    <TouchableOpacity
                      onPress={() => {
                        if (customInput.trim()) {
                          onValueChange(customInput.trim());
                          setCustomInput('');
                          setModalVisible(false);
                        }
                      }}
                      style={{ backgroundColor: colors.tint, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, marginLeft: 8 }}
                      activeOpacity={0.7}
                    >
                      <Text style={{ color: '#fff', fontWeight: 'bold' }}>Set</Text>
                    </TouchableOpacity>
                  </View>
                );
              }
              return (
                <TouchableOpacity
                  style={{ padding: 20, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: item === value ? colors.inputBg : 'transparent' }}
                  onPress={() => {
                    onValueChange(item);
                    setModalVisible(false);
                  }}
                  activeOpacity={0.6}
                >
                  <Text style={{ fontSize: 16, color: colors.text, fontWeight: item === value ? 'bold' : 'normal', textAlign: 'center' }}>
                    {item}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
}

export default function SettingsScreen() {
  const { globalApiKey, setGlobalApiKey, setAiProvider, aiProvider, openaiModel, anthropicModel, geminiModel, setModels, availableOpenaiModels, availableAnthropicModels, availableGeminiModels, setAvailableModels, keyValidated, setKeyValidated } = useSettingsStore();
  const { session, updateUserMetadata } = useAuthStore();
  const [displayName, setDisplayName] = useState(session?.user?.user_metadata?.display_name || '');
  const [keyInput, setKeyInput] = useState(globalApiKey);

  const [localOpenai, setLocalOpenai] = useState(openaiModel);
  const [localAnthropic, setLocalAnthropic] = useState(anthropicModel);
  const [localGemini, setLocalGemini] = useState(geminiModel);
  const [loading, setLoading] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [detectedProvider, setDetectedProvider] = useState<AiProvider | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);

  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();

  // Auto-detect provider as user types
  useEffect(() => {
    const token = keyInput.trim();
    if (token.startsWith('sk-ant')) setDetectedProvider('anthropic');
    else if (token.startsWith('AIza')) setDetectedProvider('gemini');
    else if (token.startsWith('sk-')) setDetectedProvider('openai');
    else setDetectedProvider(null);
  }, [keyInput]);

  const handleAuthenticate = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    const token = keyInput.trim();
    if (!token) {
      setErrorMsg('Please enter an API key');
      return;
    }

    setLoading(true);

    if (displayName.trim() && displayName.trim() !== session?.user?.user_metadata?.display_name) {
      await updateUserMetadata(displayName.trim());
    }

    if (!detectedProvider) {
      setErrorMsg('Invalid key format. Ensure it starts with sk- (OpenAI), sk-ant (Anthropic), or AIza (Gemini).');
      setLoading(false);
      return;
    }

    try {
      // Validate the key with a lightweight API call
      if (detectedProvider === 'openai') {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("OpenAI API Key invalid or expired.");
      } else if (detectedProvider === 'anthropic') {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": token, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({})
        });
        if (res.status === 401) throw new Error("Anthropic API Key invalid.");
        // 400 is expected (empty body) — means key is valid
      } else if (detectedProvider === 'gemini') {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${token}`);
        if (!res.ok) throw new Error("Gemini API Key invalid or expired.");
      }

      // Key is valid — save it
      setGlobalApiKey(token);
      setAiProvider(detectedProvider);
      setKeyValidated(true);
      setSuccessMsg(`${detectedProvider.charAt(0).toUpperCase() + detectedProvider.slice(1)} key verified. Fetching available models...`);

      // Fetch available models dynamically
      setFetchingModels(true);
      const models = await fetchAvailableModels(detectedProvider, token);
      setAvailableModels(detectedProvider, models);
      setFetchingModels(false);

      if (models.length > 0) {
        // Auto-select the first model if user hasn't picked one for this provider
        if (detectedProvider === 'openai' && !localOpenai) setLocalOpenai(models[0]);
        if (detectedProvider === 'anthropic' && !localAnthropic) setLocalAnthropic(models[0]);
        if (detectedProvider === 'gemini' && !localGemini) setLocalGemini(models[0]);
        setSuccessMsg(`Key verified! ${models.length} models available for ${detectedProvider}. Select your model below, then proceed.`);
      } else {
        setSuccessMsg(`Key verified for ${detectedProvider}! Enter a model ID manually below.`);
      }

    } catch (e: any) {
      setErrorMsg(e.message);
      setKeyValidated(false);
    } finally {
      setLoading(false);
    }
  };

  const handleProceed = () => {
    const activeOpenai = localOpenai.trim();
    const activeAnthropic = localAnthropic.trim();
    const activeGemini = localGemini.trim();

    // Ensure the active provider has a model selected
    if (detectedProvider === 'openai' && !activeOpenai) {
      setErrorMsg('Please select an OpenAI model before proceeding.');
      return;
    }
    if (detectedProvider === 'anthropic' && !activeAnthropic) {
      setErrorMsg('Please select an Anthropic model before proceeding.');
      return;
    }
    if (detectedProvider === 'gemini' && !activeGemini) {
      setErrorMsg('Please select a Gemini model before proceeding.');
      return;
    }

    setModels(activeOpenai, activeAnthropic, activeGemini);
    router.replace('/');
  };

  const currentModels = detectedProvider === 'openai' ? availableOpenaiModels
    : detectedProvider === 'anthropic' ? availableAnthropicModels
    : detectedProvider === 'gemini' ? availableGeminiModels
    : [];

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={styles.content}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, marginTop: 16 }}>
        <Text style={[styles.headerTitle, { color: colors.text, marginTop: 0, marginBottom: 0 }]}>Global AI Access</Text>
        <TouchableOpacity onPress={() => setShowTutorial(true)} style={{ padding: 4 }} activeOpacity={0.6}>
           <HelpCircle color={colors.tint} size={24} />
        </TouchableOpacity>
      </View>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Drop your API key here. AIMS auto-detects the provider and fetches your available models.
      </Text>

      {errorMsg ? (
        <View style={styles.errorBox}>
          <AlertCircle color="#991b1b" size={16} style={{ marginRight: 6 }} />
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      ) : null}

      {successMsg ? (
        <View style={styles.successBox}>
          <CheckCircle color="#166534" size={16} style={{ marginRight: 6 }} />
          <Text style={styles.successText}>{successMsg}</Text>
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
          placeholder="sk-... or AIza..."
          placeholderTextColor={colors.textSecondary}
          secureTextEntry
          value={keyInput}
          onChangeText={setKeyInput}
          autoCapitalize="none"
        />
      </View>

      {detectedProvider && (
        <Text style={{ color: colors.tint, fontSize: 13, marginBottom: 12, marginLeft: 4, fontWeight: '600' }}>
          Detected: {detectedProvider.charAt(0).toUpperCase() + detectedProvider.slice(1)}
        </Text>
      )}

      <TouchableOpacity
        style={[styles.authButton, { backgroundColor: colors.tint }, loading && styles.disabled]}
        disabled={loading}
        onPress={handleAuthenticate}
        activeOpacity={0.7}
      >
        {loading ? <ActivityIndicator color="#fff" /> : (
          <>
            <ShieldCheck color="#fff" size={20} style={{ marginRight: 8 }} />
            <Text style={styles.authButtonText}>Validate Key & Fetch Models</Text>
          </>
        )}
      </TouchableOpacity>

      {fetchingModels && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
          <ActivityIndicator size="small" color={colors.tint} style={{ marginRight: 8 }} />
          <Text style={{ color: colors.textSecondary }}>Fetching available models...</Text>
        </View>
      )}

      {keyValidated && (
        <>
          <Text style={[styles.label, { color: colors.text, marginTop: 24 }]}>
            Select Model {detectedProvider ? `(${detectedProvider})` : ''}
          </Text>
          <Text style={{ color: colors.textSecondary, marginBottom: 12, fontSize: 13, marginLeft: 4 }}>
            {currentModels.length > 0
              ? `${currentModels.length} models available. Pick one or type a custom model ID.`
              : 'Type a model ID manually below.'}
          </Text>

          {(detectedProvider === 'openai' || availableOpenaiModels.length > 0) && (
            <View style={[styles.inputContainer, { backgroundColor: colors.inputBg, borderColor: colors.border, paddingVertical: Platform.OS === 'ios' ? 0 : 4 }]}>
              <CustomPicker value={localOpenai} onValueChange={setLocalOpenai} options={availableOpenaiModels} placeholder="Select OpenAI Model..." colors={colors} allowCustom />
            </View>
          )}
          {(detectedProvider === 'anthropic' || availableAnthropicModels.length > 0) && (
            <View style={[styles.inputContainer, { backgroundColor: colors.inputBg, borderColor: colors.border, paddingVertical: Platform.OS === 'ios' ? 0 : 4 }]}>
              <CustomPicker value={localAnthropic} onValueChange={setLocalAnthropic} options={availableAnthropicModels} placeholder="Select Anthropic Model..." colors={colors} allowCustom />
            </View>
          )}
          {(detectedProvider === 'gemini' || availableGeminiModels.length > 0) && (
            <View style={[styles.inputContainer, { backgroundColor: colors.inputBg, borderColor: colors.border, paddingVertical: Platform.OS === 'ios' ? 0 : 4 }]}>
              <CustomPicker value={localGemini} onValueChange={setLocalGemini} options={availableGeminiModels} placeholder="Select Gemini Model..." colors={colors} allowCustom />
            </View>
          )}

          <TouchableOpacity
            style={[styles.authButton, { backgroundColor: '#10b981', marginTop: 16 }]}
            onPress={handleProceed}
            activeOpacity={0.7}
          >
            <Text style={styles.authButtonText}>Save & Proceed</Text>
          </TouchableOpacity>
        </>
      )}

      <Text style={[styles.helperText, { color: colors.textSecondary }]}>
        Your key is stored locally on-device via MMKV and sent directly to the LLM provider over HTTPS. It never touches our servers.
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
  errorBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fee2e2', padding: 12, borderRadius: 8, marginBottom: 16 },
  errorText: { color: '#991b1b', fontSize: 14, flex: 1 },
  successBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#dcfce7', padding: 12, borderRadius: 8, marginBottom: 16 },
  successText: { color: '#166534', fontSize: 14, flex: 1 },
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
  helperText: { fontSize: 13, marginTop: 24, lineHeight: 20, textAlign: 'center' }
});
