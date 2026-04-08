import React, { useState, useEffect } from 'react';
import { StyleSheet, View, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, FlatList, useColorScheme, ActivityIndicator, Share, Modal, ScrollView, Text } from 'react-native';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import Markdown from 'react-native-markdown-display';
import { Send, ArrowLeft, Sparkles, LogOut, Copy, Share as ShareIcon, Lock, RefreshCw, BookOpen, X, ChevronDown } from 'lucide-react-native';
import { useChatStore } from '@/lib/store/chatStore';
import { useAuthStore } from '@/lib/store/authStore';
import { useSettingsStore } from '@/lib/store/settingsStore';
import { AlertCircle } from 'lucide-react-native';
import { ChatBubble } from '@/components/ChatBubble';
import { Message, RoomStatus } from '@/lib/types';
import Colors from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { streamChimeIn, generateRoomTitle, callModelDirect, getLightModel, getFlagshipModel, runFiveLayerAnalysis, extractMetadata } from '@/lib/api/agent';
import { buildPass1Prompt, parsePass1Response, buildPass2Prompt, FIVE_LAYER_PROMPTS } from '@/services/agent-dispatch';

const generateId = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

const STATUS_LABELS: Record<RoomStatus, { label: string; color: string }> = {
  brainstorming: { label: 'Brainstorming', color: '#6366f1' },
  scoping: { label: 'Scoping', color: '#f59e0b' },
  building: { label: 'Building', color: '#10b981' },
  shipped: { label: 'Shipped', color: '#ec4899' },
};
const STATUS_ORDER: RoomStatus[] = ['brainstorming', 'scoping', 'building', 'shipped'];

export default function RoomScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { rooms, messages, loadMessages, queueMessage, addMessage, updateMessage, removeMessage, subscribeToRoom, updateRoomName, updateRoomLock, updateRoomStatus, updateRoomDetails, regenerateInviteCode } = useChatStore();
  const { session } = useAuthStore();
  const { aiProvider, globalApiKey, openaiModel, anthropicModel, geminiModel } = useSettingsStore();

  const activeModel = aiProvider === 'openai' ? openaiModel : aiProvider === 'anthropic' ? anthropicModel : geminiModel;

  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [summaryText, setSummaryText] = useState('');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isAIAnalysing, setIsAIAnalysing] = useState(false);
  const [showCatchUpBanner, setShowCatchUpBanner] = useState(false);
  const [fallbackNotice, setFallbackNotice] = useState<{ from: string; to: string } | null>(null);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const roomMessages = messages.filter(m => m.room_id === id);
  const currentRoom = rooms.find(r => r.id === id);
  const [localRoomName, setLocalRoomName] = useState(currentRoom?.name || `Room ${id}`);
  const roomStatus = currentRoom?.status || 'brainstorming';

  useEffect(() => {
    if (currentRoom?.name) setLocalRoomName(currentRoom.name);
  }, [currentRoom?.name]);

  const submitRoomName = () => {
    if (localRoomName.trim() && localRoomName !== currentRoom?.name) {
      updateRoomName(id as string, localRoomName);
    } else {
      setLocalRoomName(currentRoom?.name || `Room ${id}`);
    }
  };

  useEffect(() => {
    let active = true;
    if (active) {
       loadMessages(id as string).then(() => {
         setLoading(false);
         const stateMessages = useChatStore.getState().messages.filter(m => m.room_id === id);
         if (stateMessages.length > 0) {
           const oldestMessage = new Date(stateMessages[stateMessages.length - 1].created_at).getTime();
           if (Date.now() - oldestMessage > 24 * 60 * 60 * 1000) {
             setShowCatchUpBanner(true);
           }
         }
       });
       subscribeToRoom(id as string);
    }
    return () => {
      active = false;
      supabase.removeAllChannels();
    };
  }, [id]);

  useEffect(() => {
    if (fallbackNotice) {
      const timer = setTimeout(() => setFallbackNotice(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [fallbackNotice]);

  const summarizeActivity = async (force: boolean = false) => {
    if (!session?.user?.id) return;
    setShowCatchUpBanner(false);
    setShowSummaryModal(true);

    if (!force && summaryText.length > 0) return;

    setIsSummarizing(true);
    setSummaryText("Initiating AIMS summarization protocol...");

    const pmPrompt = "You are an assistant. Briefly summarize what was recently discussed in this chat room in 3 concise bullet points. Be extremely brief.";
    const chronologicalMessages = [...roomMessages].reverse().slice(-80);
    const availableModels = useSettingsStore.getState().getAvailableModelsForActiveProvider();

    const stream = streamChimeIn(
      aiProvider, globalApiKey, activeModel, pmPrompt, chronologicalMessages,
      availableModels, (from, to) => setFallbackNotice({ from, to })
    );

    let accumulatedText = "";
    for await (const chunk of stream) {
      if (accumulatedText.startsWith("Initiating")) accumulatedText = "";
      accumulatedText += chunk;
      setSummaryText(accumulatedText);
    }
    setIsSummarizing(false);
  };

  // ---- TWO-PASS PROMPTING: handleAIResponse ----
  const handleAIResponse = async (userText: string) => {
    if (!session?.user?.id || isAIAnalysing) return;
    setIsAIAnalysing(true);
    setFallbackNotice(null);

    const availableModels = useSettingsStore.getState().getAvailableModelsForActiveProvider();
    const flagship = getFlagshipModel(availableModels);
    const light = getLightModel(availableModels);

    // --- Context Summary (auto-generate on first chime-in) ---
    let contextSummary = summaryText;
    if ((!contextSummary || contextSummary.length === 0) && roomMessages.length > 5) {
      const agentContextId = generateId();
      addMessage({
        id: agentContextId, room_id: id as string, sender_id: session.user.id,
        sender_type: 'agent', sender_name: 'system',
        content: 'Building context summary...', created_at: new Date().toISOString()
      });

      const pmPrompt = "You are an assistant. Briefly summarize what has been discussed in this chat room in 3 concise bullet points. Be extremely brief.";
      const chronologicalMessages = [...roomMessages].reverse().slice(-80);

      const summaryStream = streamChimeIn(
        aiProvider, globalApiKey, activeModel, pmPrompt, chronologicalMessages,
        availableModels, (from, to) => setFallbackNotice({ from, to })
      );

      let generatedSummary = "";
      for await (const chunk of summaryStream) {
        generatedSummary += chunk;
        updateMessage(agentContextId, { content: `Building context...\n\n${generatedSummary}` });
      }
      contextSummary = generatedSummary;
      setSummaryText(generatedSummary);
      removeMessage(agentContextId);
    }

    // --- PASS 1: Flagship builds the blueprint (or Five-Layer Fallback) ---
    let pass1Role: string;
    let pass1Blueprint: string;
    const chronoForAnalysis = [...roomMessages].reverse().slice(-30);

    if (flagship) {
      try {
        const pass1Prompt = buildPass1Prompt(chronoForAnalysis);
        const dummyMsg: Message[] = [{
          id: 'pass1', room_id: id as string, sender_id: null, sender_type: 'user',
          content: userText || 'What are your thoughts on the ideas discussed?',
          created_at: new Date().toISOString()
        }];
        const pass1Raw = await callModelDirect(aiProvider, globalApiKey, flagship, pass1Prompt, dummyMsg);
        const result = parsePass1Response(pass1Raw);
        pass1Role = result.role;
        pass1Blueprint = result.blueprint;
      } catch {
        // Flagship failed — five-layer fallback builds the blueprint instead
        if (light) {
          const result = await runFiveLayerAnalysis(aiProvider, globalApiKey, light, chronoForAnalysis);
          pass1Role = result.role;
          pass1Blueprint = result.blueprint;
        } else {
          pass1Role = 'Advisor';
          pass1Blueprint = 'PERSONA: You are a direct, helpful advisor.\n\nARGUMENT STRUCTURE:\n1. Address the latest point with a specific opinion\n2. Offer one actionable suggestion\n3. Flag one risk\n\nTONE: Direct. No hedging.\n\nFORMAT: Short paragraphs. End with a next step.\n\nMUST AVOID: Vague advice.';
        }
      }
    } else if (light) {
      const result = await runFiveLayerAnalysis(aiProvider, globalApiKey, light, chronoForAnalysis);
      pass1Role = result.role;
      pass1Blueprint = result.blueprint;
    } else {
      pass1Role = 'Advisor';
      pass1Blueprint = 'PERSONA: You are a direct, helpful advisor.\n\nARGUMENT STRUCTURE:\n1. Address the latest point with a specific opinion\n2. Offer one actionable suggestion\n3. Flag one risk\n\nTONE: Direct. No hedging.\n\nFORMAT: Short paragraphs. End with a next step.\n\nMUST AVOID: Vague advice.';
    }

    // Append context summary into the blueprint
    if (contextSummary && contextSummary.length > 0 && !contextSummary.startsWith('[Error')) {
      pass1Blueprint += `\n\nCONVERSATION SUMMARY (for additional context):\n${contextSummary}`;
    }

    // Build the Pass 2 system prompt from the blueprint
    const pass2SystemPrompt = buildPass2Prompt(pass1Blueprint);

    // Auto-name detection
    if (localRoomName === "Brainstorming Session") {
      const chronoTitleMsgs = [...roomMessages].reverse().slice(-20);
      generateRoomTitle(aiProvider, globalApiKey, chronoTitleMsgs).then((newTitle) => {
         if (newTitle) {
           updateRoomName(id as string, newTitle);
           setLocalRoomName(newTitle);
         }
      });
    }

    // --- PASS 2: Light model executes the blueprint (streamed) ---
    const responseModel = light || activeModel;
    const agentMsgId = generateId();
    addMessage({
      id: agentMsgId, room_id: id as string, sender_id: session.user.id,
      sender_type: 'agent', sender_name: pass1Role,
      content: '...', created_at: new Date().toISOString()
    });

    let accumulatedText = "";
    const chronoChatMsgs = [...roomMessages].reverse().slice(-50);

    const stream = streamChimeIn(
      aiProvider, globalApiKey, responseModel, pass2SystemPrompt, chronoChatMsgs,
      availableModels, (from, to) => setFallbackNotice({ from, to })
    );

    for await (const chunk of stream) {
      accumulatedText += chunk;
      updateMessage(agentMsgId, { content: accumulatedText });
    }

    // Save final response to backend
    await supabase.from('messages').insert({
      id: agentMsgId, room_id: id as string, sender_id: session.user.id,
      sender_type: 'agent', sender_name: pass1Role, content: accumulatedText,
    });

    // Fire-and-forget: extract metadata for room details
    if (roomMessages.length > 3) {
      const chronoMeta = [...roomMessages].reverse().slice(-30);
      extractMetadata(aiProvider, globalApiKey, responseModel, chronoMeta).then((details) => {
        if (details && Object.keys(details).length > 0) {
          updateRoomDetails(id as string, details);
        }
      });
    }

    setIsAIAnalysing(false);
  };

  // ---- REGENERATE: Flagship reviews and rewrites ----
  const handleRegenerate = async (messageId: string, originalContent: string) => {
    if (!session?.user?.id || isAIAnalysing) return;
    setIsAIAnalysing(true);

    const availableModels = useSettingsStore.getState().getAvailableModelsForActiveProvider();
    const flagship = getFlagshipModel(availableModels);
    const model = flagship || activeModel;

    const chatContext = [...roomMessages].reverse().slice(-20)
      .map(m => `[${m.sender_name || m.sender_type}]: ${m.content}`).join('\n');

    const overseerPrompt = FIVE_LAYER_PROMPTS.overseer(originalContent, chatContext);
    const dummyMsg: Message[] = [{
      id: 'regen', room_id: id as string, sender_id: null, sender_type: 'user',
      content: 'Improve this response.', created_at: new Date().toISOString()
    }];

    updateMessage(messageId, { content: '...' });

    let accumulatedText = "";
    try {
      const stream = streamChimeIn(
        aiProvider, globalApiKey, model, overseerPrompt, dummyMsg,
        availableModels, (from, to) => setFallbackNotice({ from, to })
      );

      for await (const chunk of stream) {
        accumulatedText += chunk;
        updateMessage(messageId, { content: accumulatedText });
      }

      // Update in backend
      await supabase.from('messages').update({ content: accumulatedText }).eq('id', messageId);
    } catch {
      // Restore original on failure
      updateMessage(messageId, { content: originalContent });
    }

    setIsAIAnalysing(false);
  };

  const sendMessage = () => {
    if (!inputText.trim() || !session) return;

    const userText = inputText.trim();
    const newMsg: Message = {
      id: generateId(),
      room_id: id as string,
      sender_id: session.user.id,
      sender_type: 'user',
      sender_name: session?.user?.user_metadata?.display_name || 'Anonymous',
      content: userText,
      created_at: new Date().toISOString()
    };

    setInputText('');
    queueMessage(newMsg);
  };

  const cycleStatus = () => {
    const currentIndex = STATUS_ORDER.indexOf(roomStatus);
    const nextStatus = STATUS_ORDER[(currentIndex + 1) % STATUS_ORDER.length];
    updateRoomStatus(id as string, nextStatus);
  };

  const statusInfo = STATUS_LABELS[roomStatus];

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TextInput
                value={localRoomName}
                onChangeText={setLocalRoomName}
                onBlur={submitRoomName}
                onSubmitEditing={submitRoomName}
                style={{ fontSize: 18, fontWeight: 'bold', color: colors.text, maxWidth: 160 }}
              />
              <TouchableOpacity
                onPress={cycleStatus}
                style={[styles.statusBadge, { backgroundColor: statusInfo.color + '20', borderColor: statusInfo.color }]}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                activeOpacity={0.6}
              >
                <Text style={[styles.statusText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
              </TouchableOpacity>
            </View>
          ),
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => router.back()}
              style={{ marginRight: 15, padding: 10 }}
              hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
              activeOpacity={0.6}
            >
              <ArrowLeft color={colors.text} size={24} />
            </TouchableOpacity>
          ),
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity
                onPress={() => alert(`Share this Room Join URL with teammates:\n\n${currentRoom?.invite_code || id}`)}
                style={{ marginRight: 8, padding: 6 }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                activeOpacity={0.6}
              >
                <Copy color={colors.textSecondary} size={20} />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                   regenerateInviteCode(id as string);
                   alert("New Invite Link Generated! The old link has been destroyed.");
                }}
                style={{ marginRight: 8, padding: 6 }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                activeOpacity={0.6}
              >
                <RefreshCw color={colors.textSecondary} size={20} />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={async () => {
                   const formatted = roomMessages.slice().reverse().map(m => `[${m.sender_name || (m.sender_type === 'user' ? 'Anonymous' : 'Agent')}]: ${m.content}`).join('\n\n');
                   await Share.share({ message: `Brainstorming Session Logs:\n\n${formatted}` });
                }}
                style={{ marginRight: 8, padding: 6 }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                activeOpacity={0.6}
              >
                <ShareIcon color={colors.textSecondary} size={20} />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                   updateRoomLock(id as string, true);
                   alert("Room locked. No new peers can join using the UUID.");
                }}
                style={{ marginRight: 8, padding: 6 }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                activeOpacity={0.6}
              >
                <Lock color={colors.textSecondary} size={20} />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => summarizeActivity(false)}
                style={{ marginRight: 8, padding: 8, backgroundColor: colors.card, borderRadius: 20 }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                activeOpacity={0.6}
              >
                <BookOpen color={colors.textSecondary} size={20} />
              </TouchableOpacity>

              <TouchableOpacity
                disabled={isAIAnalysing}
                onPress={() => handleAIResponse(inputText || "What are your thoughts on the recent ideas in this room?")}
                style={{ padding: 8, backgroundColor: colorScheme === 'dark' ? '#2e1065' : '#fef08a', borderRadius: 20, opacity: isAIAnalysing ? 0.4 : 1 }}
              >
                {isAIAnalysing ? <ActivityIndicator size="small" color={colors.tint} /> : <Sparkles color={colorScheme === 'dark' ? '#c4b5fd' : '#b45309'} size={20} />}
              </TouchableOpacity>
            </View>
          ),
        }}
      />

      {showCatchUpBanner && (
        <View style={{ backgroundColor: '#10b981', padding: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: 'bold' }}>You've been gone a while.</Text>
          <TouchableOpacity onPress={() => summarizeActivity(true)} style={{ backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }} activeOpacity={0.7}>
             <Text style={{ color: '#10b981', fontWeight: 'bold', fontSize: 12 }}>Catch Me Up</Text>
          </TouchableOpacity>
        </View>
      )}

      {fallbackNotice && (
        <View style={{ backgroundColor: '#fbbf24', padding: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 }}>
          <AlertCircle color="#92400e" size={18} style={{ marginRight: 8 }} />
          <Text style={{ color: '#92400e', fontWeight: '600', fontSize: 14, flex: 1 }}>
            Switched to {fallbackNotice.to} due to quota limits
          </Text>
          <TouchableOpacity onPress={() => setFallbackNotice(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.6}>
            <Text style={{ color: '#92400e', fontWeight: 'bold' }}>X</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} size="large" color={colors.tint} />
      ) : (
        <FlatList
          data={roomMessages}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <ChatBubble
              message={item}
              isHost={item.sender_id === currentRoom?.created_by}
              currentUserId={session?.user?.id}
              onRegenerate={handleRegenerate}
            />
          )}
          contentContainerStyle={styles.chatContainer}
          inverted={true}
        />
      )}

      <View style={[styles.inputWrapper, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
        <TextInput
          style={[styles.input, { backgroundColor: colors.inputBg, color: colors.text, borderColor: colors.border }]}
          placeholder="Type an idea or question..."
          placeholderTextColor={colors.textSecondary}
          value={inputText}
          onChangeText={setInputText}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled, { backgroundColor: colors.tint }]}
          onPress={sendMessage}
          disabled={!inputText.trim()}
          hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
          activeOpacity={0.6}
        >
          <Send size={18} color="#ffffff" style={styles.sendIcon} />
        </TouchableOpacity>
      </View>

      <Modal transparent visible={showSummaryModal} animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }}>
           <View style={{ width: '85%', maxHeight: '70%', backgroundColor: colors.card, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: colors.border }}>
               <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                 <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                   <Text style={{ fontSize: 18, fontWeight: 'bold', color: colors.text, marginRight: 12 }}>Activity Summary</Text>
                   {!isSummarizing && (
                     <TouchableOpacity onPress={() => summarizeActivity(true)} style={{ flexDirection: 'row', alignItems: 'center', padding: 4, backgroundColor: colors.background, borderRadius: 8 }} activeOpacity={0.6}>
                       <RefreshCw color={colors.tint} size={14} style={{ marginRight: 4 }} />
                       <Text style={{ color: colors.tint, fontSize: 12, fontWeight: 'bold' }}>Update</Text>
                     </TouchableOpacity>
                   )}
                 </View>
                 <TouchableOpacity onPress={() => setShowSummaryModal(false)} activeOpacity={0.6} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <X color={colors.textSecondary} size={24} />
                 </TouchableOpacity>
              </View>
              <ScrollView>
                 <Markdown
                   style={{
                     body: { color: colors.text, fontSize: 16, lineHeight: 24 },
                     bullet_list: { color: colors.text, marginVertical: 4 },
                     list_item: { color: colors.text, marginBottom: 6 },
                     strong: { color: colors.text, fontWeight: 'bold' }
                   }}
                 >
                   {summaryText}
                 </Markdown>
                 {isSummarizing && <ActivityIndicator size="small" color={colors.tint} style={{ marginTop: 16, alignSelf: 'flex-start' }} />}
              </ScrollView>
           </View>
        </View>
      </Modal>

    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  chatContainer: { padding: 16, paddingBottom: 24 },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'flex-end', padding: 12, paddingBottom: 32, borderTopWidth: 1,
  },
  input: {
    flex: 1, borderRadius: 20, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
    fontSize: 16, minHeight: 45, maxHeight: 120, borderWidth: 1,
  },
  aiButton: {
    width: 45, height: 45, borderRadius: 22.5, justifyContent: 'center', alignItems: 'center', marginLeft: 12, marginBottom: 2,
  },
  sendButton: {
    width: 45, height: 45, borderRadius: 22.5, justifyContent: 'center', alignItems: 'center', marginLeft: 8, marginBottom: 2,
  },
  sendButtonDisabled: { opacity: 0.5 },
  sendIcon: { marginLeft: -2 },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    marginLeft: 8,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
