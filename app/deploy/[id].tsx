import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, ScrollView, Pressable, useColorScheme, ActivityIndicator, Share } from 'react-native';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import Markdown from 'react-native-markdown-display';
import { ArrowLeft, Rocket, Share as ShareIcon } from 'lucide-react-native';
import Colors from '@/constants/Colors';
import { streamChimeIn } from '@/lib/api/agent';
import { useSettingsStore } from '@/lib/store/settingsStore';
import { supabase } from '@/lib/supabase';
import { Message, Room } from '@/lib/types';

export default function DeployScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  const { aiProvider, globalApiKey, openaiModel, anthropicModel, geminiModel } = useSettingsStore();
  const activeModel = aiProvider === 'openai' ? openaiModel : aiProvider === 'anthropic' ? anthropicModel : geminiModel;

  const [guideline, setGuideline] = useState('');
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(true);
  const [roomName, setRoomName] = useState('Deployment');
  const [deployStepMessage, setDeployStepMessage] = useState('Initializing AIMS Architect...');

  const executeAgentSilent = async (prompt: string, payload: Message[]): Promise<string> => {
    const stream = streamChimeIn(aiProvider, globalApiKey, activeModel, prompt, payload);
    let result = "";
    for await (const chunk of stream) result += chunk;
    return result;
  };

  useEffect(() => {
    async function startDeploy() {
      // 1. Fetch entire room history perfectly directly from backend
      const { data: roomData } = await supabase.from('rooms').select('name').eq('id', id as string).single();
      if (roomData) setRoomName(roomData.name);

      const { data: rawMessages } = await supabase.from('messages')
        .select('*')
        .eq('room_id', id as string)
        .order('created_at', { ascending: true }); // Important: Ascending for correct context timing!
        
      setLoading(false);

      if (!rawMessages || rawMessages.length === 0) {
        setGuideline("There is no context in this room to deploy. Go brainstorm first!");
        setDeploying(false);
        return;
      }

      // 2. Format Chronicle: Reverse to make chronological, keep last 200
      const chronologicalMessages = [...(rawMessages || [])].reverse().slice(-200);
      const formattedLog = chronologicalMessages.map((m: any) => {
         const date = new Date(m.created_at);
         const timeString = `${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
         const sender = m.sender_name || (m.sender_type === 'user' ? 'Anonymous' : 'AI Agent');
         return `[${timeString}] [${sender}]: ${m.content}`;
      }).join('\n');

      const mockPayload: Message[] = [{
        id: "mock-deploy",
        room_id: id as string,
        sender_id: "system",
        sender_type: "user",
        sender_name: "Transcript Compiler",
        content: `--- RAW BRAINSTORM TRANSCRIPT LOG ---\n\n${formattedLog}`,
        created_at: new Date().toISOString()
      }];

      // Step 1: Product Owner (Condense)
      setDeployStepMessage('Step 1/3: Reading logs and condensing brief...');
      const pmPrompt = "You are a Product Owner. Read this raw brainstorm transcript and write a concise, highly refined brief defining the core app idea, targeted features, and primary audience. Ignore all irrelevant chatter and side conversations.";
      const productBrief = await executeAgentSilent(pmPrompt, mockPayload);

      // Step 2: Senior Developer (Initial Draft)
      setDeployStepMessage('Step 2/3: Architecting technical blueprint...');
      const seniorDevPrompt = "You are a Senior Engineer. Read this app brief and output a highly technical, step-by-step building guideline including PRD, stack (Expo/React Native), and roadmap. Format using Markdown.";
      const step2Payload: Message[] = [{
        id: "mock-brief",
        room_id: id as string,
        sender_id: "system",
        sender_type: "user",
        sender_name: "Product Owner",
        content: `--- APPROVED APP BRIEF ---\n\n${productBrief}`,
        created_at: new Date().toISOString()
      }];
      const initialDraft = await executeAgentSilent(seniorDevPrompt, step2Payload);

      // Step 3: Staff Engineer (Assessment & Polish)
      setDeployStepMessage('Step 3/3: Staff Engineer finalizing architecture...');
      const staffPrompt = "You are a Staff Engineer reviewing a technical blueprint. Assess it for flaws, optimize the tech stack recommendations (enforce Supabase and React Native MMKV), and output the finalized, flawless Markdown guideline. Do not include introductory chatter, just the final markdown.";
      const step3Payload: Message[] = [{
        id: "mock-draft",
        room_id: id as string,
        sender_id: "system",
        sender_type: "user",
        sender_name: "Senior Engineer",
        content: `--- INITIAL DRAFT FOR REVIEW ---\n\n${initialDraft}`,
        created_at: new Date().toISOString()
      }];

      const stream = streamChimeIn(aiProvider, globalApiKey, activeModel, staffPrompt, step3Payload);
      
      let aggregated = "";
      // eslint-disable-next-line no-unreachable-loop
      for await (const chunk of stream) {
        aggregated += chunk;
        setGuideline(aggregated);
      }
      setDeploying(false);
    }
    
    startDeploy();
  }, [id]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen 
        options={{
          headerTitle: `Deploy: ${roomName}`,
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          headerLeft: () => (
            <Pressable onPress={() => router.back()} style={{ marginRight: 15 }}>
              <ArrowLeft color={colors.text} size={24} />
            </Pressable>
          ),
          headerRight: () => (
            <Pressable 
              disabled={deploying}
              onPress={async () => {
                 await Share.share({ message: `AIMS Deployment Blueprint:\n\n${guideline}` });
              }} 
              style={{ opacity: deploying ? 0.3 : 1, padding: 6 }}
            >
              <ShareIcon color={colors.textSecondary} size={22} />
            </Pressable>
          ),
        }} 
      />

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} size="large" color={colors.tint} />
      ) : (
        <ScrollView style={styles.canvas} contentContainerStyle={{ paddingBottom: 50 }}>
          {deploying && (
             <View style={styles.deployBadge}>
                <Rocket color="#10b981" size={18} style={{ marginRight: 8 }} />
                <Text style={styles.deployText}>{deployStepMessage}</Text>
             </View>
          )}
          
          <Markdown 
            style={{
              body: { color: colors.text, fontSize: 16, lineHeight: 26 },
              heading1: { color: colors.text, fontSize: 24, fontWeight: 'bold', marginTop: 16, marginBottom: 8 },
              heading2: { color: colors.text, fontSize: 20, fontWeight: 'bold', marginTop: 16, marginBottom: 8 },
              heading3: { color: colors.text, fontSize: 18, fontWeight: '600', marginTop: 12, marginBottom: 6 },
              bullet_list: { color: colors.text, marginBottom: 8 },
              ordered_list: { color: colors.text, marginBottom: 8 },
              list_item: { color: colors.text, marginBottom: 4 },
              strong: { color: colors.text, fontWeight: 'bold' },
              em: { color: colors.text, fontStyle: 'italic' },
              code_inline: { color: '#ec4899', backgroundColor: colors.border, paddingHorizontal: 4, borderRadius: 4 },
              code_block: { backgroundColor: colors.border, padding: 12, borderRadius: 8, color: colors.text, overflow: 'hidden' },
              fence: { backgroundColor: colors.border, padding: 12, borderRadius: 8, color: colors.text, overflow: 'hidden', marginVertical: 8 },
              blockquote: { borderLeftWidth: 4, borderLeftColor: colors.tint, paddingLeft: 12, opacity: 0.8 },
              hr: { backgroundColor: colors.border, height: 1, marginVertical: 16 }
            }}
          >
            {guideline}
          </Markdown>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  canvas: { padding: 20 },
  deployBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#d1fae5', padding: 12, borderRadius: 12, marginBottom: 20 },
  deployText: { color: '#047857', fontWeight: 'bold' }
});
