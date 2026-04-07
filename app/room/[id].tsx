import React, { useState, useEffect } from 'react';
import { StyleSheet, View, TextInput, Pressable, KeyboardAvoidingView, Platform, FlatList, useColorScheme, ActivityIndicator, Share, Modal, ScrollView, Text } from 'react-native';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import Markdown from 'react-native-markdown-display';
import { Send, ArrowLeft, Sparkles, LogOut, Copy, Share as ShareIcon, Lock, RefreshCw, BookOpen, X } from 'lucide-react-native';
import { useChatStore } from '@/lib/store/chatStore';
import { useAuthStore } from '@/lib/store/authStore';
import { useSettingsStore } from '@/lib/store/settingsStore';
import { ChatBubble } from '@/components/ChatBubble';
import { Message } from '@/lib/types';
import Colors from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { streamChimeIn, generateRoomTitle } from '@/lib/api/agent';
import { classifyRoleLocal, getSystemContext } from '@/services/agent-dispatch';

const generateId = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

export default function RoomScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { rooms, messages, loadMessages, queueMessage, addMessage, updateMessage, subscribeToRoom, updateRoomName, updateRoomLock, regenerateInviteCode } = useChatStore();
  const { session } = useAuthStore();
  const { aiProvider, globalApiKey, openaiModel, anthropicModel, geminiModel } = useSettingsStore();

  const activeModel = aiProvider === 'openai' ? openaiModel : aiProvider === 'anthropic' ? anthropicModel : geminiModel;

  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [summaryText, setSummaryText] = useState('');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [showCatchUpBanner, setShowCatchUpBanner] = useState(false);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const roomMessages = messages.filter(m => m.room_id === id);
  const currentRoom = rooms.find(r => r.id === id);
  const [localRoomName, setLocalRoomName] = useState(currentRoom?.name || `Room ${id}`);

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
         // Detect a 24h gap for Catch Me Up banner
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

  const summarizeActivity = async (force: boolean = false) => {
    if (!session?.user?.id) return;
    setShowCatchUpBanner(false);
    setShowSummaryModal(true);
    
    // Session Persistence: Skip if already generated (unless forced)
    if (!force && summaryText.length > 0) return;

    setIsSummarizing(true);
    setSummaryText("Initiating AIMS summarization protocol...");

    const pmPrompt = "You are an assistant. Briefly summarize what was recently discussed in this chat room in 3 concise bullet points. Be extremely brief.";
    // Truncation: Hard-cap context to last 80 messages for summary
    const chronologicalMessages = [...roomMessages].reverse().slice(-80);
    const stream = streamChimeIn(aiProvider, globalApiKey, activeModel, pmPrompt, chronologicalMessages);
    
    let accumulatedText = "";
    // eslint-disable-next-line no-unreachable-loop
    for await (const chunk of stream) {
      if (accumulatedText.startsWith("Initiating")) accumulatedText = "";
      accumulatedText += chunk;
      setSummaryText(accumulatedText);
    }
    setIsSummarizing(false);
  };

  const handleAIResponse = async (userText: string) => {
    if (!session?.user?.id) return;

    const roleContext = classifyRoleLocal(userText);
    let systemPrompt = getSystemContext(roleContext);
    if (summaryText && summaryText.length > 0 && !summaryText.startsWith('Initiating')) {
      systemPrompt += `\n\nHere is a recent summary of the conversation so far for additional context:\n${summaryText}`;
    }

    // Auto-name detection
    if (localRoomName === "Brainstorming Session") {
      // Truncation: Hard-cap context to last 20 messages for naming
      const chronoTitleMsgs = [...roomMessages].reverse().slice(-20);
      generateRoomTitle(aiProvider, globalApiKey, chronoTitleMsgs).then((newTitle) => {
         if (newTitle) {
           updateRoomName(id as string, newTitle);
           setLocalRoomName(newTitle);
         }
      });
    }

    const agentMsgId = generateId();
    addMessage({
      id: agentMsgId,
      room_id: id as string,
      sender_id: session.user.id, 
      sender_type: 'agent',
      sender_name: roleContext,
      content: '...', // Show loading state instead of blank space
      created_at: new Date().toISOString()
    });

    let accumulatedText = "";
    // Truncation: Hard-cap memory. The LLM ONLY sees the last 50 messages to prevent token exhaust.
    const chronoChatMsgs = [...roomMessages].reverse().slice(-50);
    const stream = streamChimeIn(aiProvider, globalApiKey, activeModel, systemPrompt, chronoChatMsgs);
    
    
    // eslint-disable-next-line no-unreachable-loop
    for await (const chunk of stream) {
      accumulatedText += chunk;
      updateMessage(agentMsgId, { content: accumulatedText });
    }

    // Save final response to backend after stream finishes to prevent rate-syncing loops
    await supabase.from('messages').insert({
      id: agentMsgId,
      room_id: id as string,
      sender_id: session.user.id,
      sender_type: 'agent',
      sender_name: roleContext,
      content: accumulatedText,
    });
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
    
    queueMessage(newMsg);
    setInputText('');
  };

  return (
    <KeyboardAvoidingView 
      style={[styles.container, { backgroundColor: colors.background }]} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <Stack.Screen 
        options={{
          headerTitle: () => (
             <TextInput 
                value={localRoomName}
                onChangeText={setLocalRoomName}
                onBlur={submitRoomName}
                onSubmitEditing={submitRoomName}
                style={{ fontSize: 18, fontWeight: 'bold', color: colors.text, maxWidth: 200 }}
             />
          ),
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => router.back()}
              style={{ marginRight: 15, padding: 8 }}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
            >
              <ArrowLeft color={colors.text} size={24} />
            </Pressable>
          ),
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Pressable 
                onPress={() => alert(`Share this Room Join URL with teammates:\n\n${currentRoom?.invite_code || id}`)} 
                style={{ marginRight: 8, padding: 6 }}
              >
                <Copy color={colors.textSecondary} size={20} />
              </Pressable>

              <Pressable 
                onPress={() => {
                   regenerateInviteCode(id as string);
                   alert("New Invite Link Generated! The old link has been destroyed.");
                }} 
                style={{ marginRight: 8, padding: 6 }}
              >
                <RefreshCw color={colors.textSecondary} size={20} />
              </Pressable>

              <Pressable 
                onPress={async () => {
                   const formatted = roomMessages.slice().reverse().map(m => `[${m.sender_name || (m.sender_type === 'user' ? 'Anonymous' : 'Agent')}]: ${m.content}`).join('\n\n');
                   await Share.share({ message: `Brainstorming Session Logs:\n\n${formatted}` });
                }} 
                style={{ marginRight: 8, padding: 6 }}
              >
                <ShareIcon color={colors.textSecondary} size={20} />
              </Pressable>

              <Pressable 
                onPress={() => {
                   updateRoomLock(id as string, true);
                   alert("Room locked. No new peers can join using the UUID.");
                }} 
                style={{ marginRight: 8, padding: 6 }}
              >
                <Lock color={colors.textSecondary} size={20} />
              </Pressable>

              <Pressable 
                onPress={() => summarizeActivity(false)} 
                style={{ marginRight: 8, padding: 8, backgroundColor: colors.card, borderRadius: 20 }}
              >
                <BookOpen color={colors.textSecondary} size={20} />
              </Pressable>

              <Pressable 
                onPress={() => handleAIResponse("What are your thoughts on the recent ideas in this room?")} 
                style={{ padding: 8, backgroundColor: colorScheme === 'dark' ? '#2e1065' : '#fef08a', borderRadius: 20 }}
              >
                <Sparkles color={colorScheme === 'dark' ? '#c4b5fd' : '#b45309'} size={20} />
              </Pressable>
            </View>
          ),
        }} 
      />

      {showCatchUpBanner && (
        <View style={{ backgroundColor: '#10b981', padding: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: 'bold' }}>You've been gone a while.</Text>
          <Pressable onPress={() => summarizeActivity(true)} style={{ backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}>
             <Text style={{ color: '#10b981', fontWeight: 'bold', fontSize: 12 }}>Catch Me Up</Text>
          </Pressable>
        </View>
      )}

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} size="large" color={colors.tint} />
      ) : (
        <FlatList
          data={roomMessages}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <ChatBubble message={item} isHost={item.sender_id === currentRoom?.created_by} currentUserId={session?.user?.id} />}
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
        <Pressable 
          style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled, { backgroundColor: colors.tint }]} 
          onPress={sendMessage}
        >
          <Send size={18} color="#ffffff" style={styles.sendIcon} />
        </Pressable>
      </View>

      <Modal transparent visible={showSummaryModal} animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }}>
           <View style={{ width: '85%', maxHeight: '70%', backgroundColor: colors.card, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: colors.border }}>
               <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                 <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                   <Text style={{ fontSize: 18, fontWeight: 'bold', color: colors.text, marginRight: 12 }}>Activity Summary</Text>
                   {!isSummarizing && (
                     <Pressable onPress={() => summarizeActivity(true)} style={{ flexDirection: 'row', alignItems: 'center', padding: 4, backgroundColor: colors.background, borderRadius: 8 }}>
                       <RefreshCw color={colors.tint} size={14} style={{ marginRight: 4 }} />
                       <Text style={{ color: colors.tint, fontSize: 12, fontWeight: 'bold' }}>Update</Text>
                     </Pressable>
                   )}
                 </View>
                 <Pressable onPress={() => setShowSummaryModal(false)}>
                    <X color={colors.textSecondary} size={24} />
                 </Pressable>
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
  sendIcon: { marginLeft: -2 }
});
