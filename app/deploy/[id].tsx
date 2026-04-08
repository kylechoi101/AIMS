import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, useColorScheme, ActivityIndicator, Share, Alert } from 'react-native';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import Markdown from 'react-native-markdown-display';
import { ArrowLeft, Rocket, Share as ShareIcon, FileText, Download } from 'lucide-react-native';
import Colors from '@/constants/Colors';
import { streamChimeIn } from '@/lib/api/agent';
import { useSettingsStore } from '@/lib/store/settingsStore';
import { useChatStore } from '@/lib/store/chatStore';
import { supabase } from '@/lib/supabase';
import { Message, Room } from '@/lib/types';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Directory, Paths } from 'expo-file-system';

/** Convert markdown to basic HTML for PDF generation. */
function markdownToHtml(md: string): string {
  let html = md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:14px;">$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/```[\s\S]*?```/g, (match) => {
      const code = match.replace(/```\w*\n?/g, '').replace(/```/g, '');
      return `<pre style="background:#1e293b;color:#e2e8f0;padding:16px;border-radius:8px;font-size:13px;overflow-x:auto;"><code>${code}</code></pre>`;
    })
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li>.*?<\/li>(?:\s*<br\/>)*)+/g, (match) => `<ul>${match.replace(/<br\/>/g, '')}</ul>`);

  return `
    <html>
    <head>
      <meta charset="utf-8"/>
      <style>
        body { font-family: -apple-system, system-ui, sans-serif; padding: 40px; color: #1f2937; line-height: 1.6; max-width: 800px; margin: 0 auto; }
        h1 { font-size: 28px; color: #111827; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
        h2 { font-size: 22px; color: #1f2937; margin-top: 24px; }
        h3 { font-size: 18px; color: #374151; }
        ul, ol { padding-left: 24px; }
        li { margin-bottom: 6px; }
        blockquote { border-left: 4px solid #6366f1; padding-left: 16px; color: #6b7280; }
        p { margin: 8px 0; }
      </style>
    </head>
    <body><p>${html}</p></body>
    </html>
  `;
}

export default function DeployScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const { aiProvider, globalApiKey, openaiModel, anthropicModel, geminiModel } = useSettingsStore();
  const { updateRoomStatus, updateRoomDetails } = useChatStore();
  const activeModel = aiProvider === 'openai' ? openaiModel : aiProvider === 'anthropic' ? anthropicModel : geminiModel;

  const [guideline, setGuideline] = useState('');
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(true);
  const [roomName, setRoomName] = useState('Deployment');
  const [deployStepMessage, setDeployStepMessage] = useState('Initializing AIMS Architect...');
  const [roomDetails, setRoomDetails] = useState<Record<string, any> | null>(null);

  const executeAgentSilent = async (prompt: string, payload: Message[]): Promise<string> => {
    const availableModels = useSettingsStore.getState().getAvailableModelsForActiveProvider();
    const stream = streamChimeIn(aiProvider, globalApiKey, activeModel, prompt, payload, availableModels);
    let result = "";
    for await (const chunk of stream) result += chunk;
    return result;
  };

  const exportPDF = async () => {
    if (!guideline) return;
    try {
      const html = markdownToHtml(guideline);
      const { uri } = await Print.printToFileAsync({ html });
      // Share the generated PDF directly from its temp location
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share Blueprint PDF' });
    } catch (err: any) {
      Alert.alert('Export Error', err.message || 'Failed to generate PDF');
    }
  };

  const saveDOCX = async () => {
    if (!guideline) return;
    try {
      const html = markdownToHtml(guideline);
      const docxContent = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"/><title>${roomName}</title></head><body>${html}</body></html>`;
      const docxName = `AIMS_Blueprint_${roomName.replace(/\s+/g, '_')}.docx`;
      // Use new expo-file-system class API
      const exportsDir = new Directory(Paths.cache, 'aims-exports');
      if (!exportsDir.exists) exportsDir.create();
      const docxFile = new File(exportsDir, docxName);
      docxFile.write(docxContent);
      await Sharing.shareAsync(docxFile.uri, { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', dialogTitle: 'Save Blueprint DOCX' });
    } catch (err: any) {
      Alert.alert('Export Error', err.message || 'Failed to generate DOCX');
    }
  };

  useEffect(() => {
    async function startDeploy() {
      // Fetch room info including details
      const { data: roomData } = await supabase.from('rooms').select('name, details, status').eq('id', id as string).single();
      if (roomData) {
        setRoomName(roomData.name);
        if (roomData.details) setRoomDetails(roomData.details);
      }

      // Auto-advance room status to 'scoping' on Deploy
      updateRoomStatus(id as string, 'scoping');

      const { data: rawMessages } = await supabase.from('messages')
        .select('*')
        .eq('room_id', id as string)
        .order('created_at', { ascending: true });

      setLoading(false);

      if (!rawMessages || rawMessages.length === 0) {
        setGuideline("There is no context in this room to deploy. Go brainstorm first!");
        setDeploying(false);
        return;
      }

      const chronologicalMessages = [...(rawMessages || [])].reverse().slice(-200);
      const formattedLog = chronologicalMessages.map((m: any) => {
         const date = new Date(m.created_at);
         const timeString = `${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
         const sender = m.sender_name || (m.sender_type === 'user' ? 'Anonymous' : 'AI Agent');
         return `[${timeString}] [${sender}]: ${m.content}`;
      }).join('\n');

      // Include room details in context if available
      let detailsContext = '';
      if (roomData?.details && Object.keys(roomData.details).length > 0) {
        detailsContext = `\n\n--- EXTRACTED PROJECT METADATA ---\n${JSON.stringify(roomData.details, null, 2)}`;
      }

      const mockPayload: Message[] = [{
        id: "mock-deploy", room_id: id as string,
        sender_id: "system", sender_type: "user", sender_name: "Transcript Compiler",
        content: `--- RAW BRAINSTORM TRANSCRIPT LOG ---\n\n${formattedLog}${detailsContext}`,
        created_at: new Date().toISOString()
      }];

      // Step 1: Product Owner
      setDeployStepMessage('Step 1/3: Reading logs and condensing brief...');
      const pmPrompt = "You are a Product Owner. Read this raw brainstorm transcript and write a concise, highly refined brief defining the core app idea, targeted features, and primary audience. Ignore all irrelevant chatter and side conversations.";
      const productBrief = await executeAgentSilent(pmPrompt, mockPayload);

      // Step 2: Senior Developer
      setDeployStepMessage('Step 2/3: Architecting technical blueprint...');
      const seniorDevPrompt = "You are a Senior Engineer. Read this app brief and output a highly technical, step-by-step building guideline including PRD, stack (Expo/React Native), and roadmap. Format using Markdown.";
      const step2Payload: Message[] = [{
        id: "mock-brief", room_id: id as string,
        sender_id: "system", sender_type: "user", sender_name: "Product Owner",
        content: `--- APPROVED APP BRIEF ---\n\n${productBrief}`,
        created_at: new Date().toISOString()
      }];
      const initialDraft = await executeAgentSilent(seniorDevPrompt, step2Payload);

      // Step 3: Staff Engineer
      setDeployStepMessage('Step 3/3: Staff Engineer finalizing architecture...');
      const staffPrompt = "You are a Staff Engineer reviewing a technical blueprint. Assess it for flaws, optimize the tech stack recommendations (enforce Supabase and React Native MMKV), and output the finalized, flawless Markdown guideline. Do not include introductory chatter, just the final markdown.";
      const step3Payload: Message[] = [{
        id: "mock-draft", room_id: id as string,
        sender_id: "system", sender_type: "user", sender_name: "Senior Engineer",
        content: `--- INITIAL DRAFT FOR REVIEW ---\n\n${initialDraft}`,
        created_at: new Date().toISOString()
      }];

      const stream = streamChimeIn(aiProvider, globalApiKey, activeModel, staffPrompt, step3Payload);

      let aggregated = "";
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
            <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 15, padding: 6 }} activeOpacity={0.6}>
              <ArrowLeft color={colors.text} size={24} />
            </TouchableOpacity>
          ),
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity
                disabled={deploying}
                onPress={saveDOCX}
                style={{ opacity: deploying ? 0.3 : 1, padding: 6, marginRight: 8 }}
                activeOpacity={0.6}
              >
                <Download color={colors.textSecondary} size={22} />
              </TouchableOpacity>
              <TouchableOpacity
                disabled={deploying}
                onPress={exportPDF}
                style={{ opacity: deploying ? 0.3 : 1, padding: 6, marginRight: 8 }}
                activeOpacity={0.6}
              >
                <FileText color={colors.textSecondary} size={22} />
              </TouchableOpacity>
              <TouchableOpacity
                disabled={deploying}
                onPress={async () => {
                   await Share.share({ message: `AIMS Deployment Blueprint:\n\n${guideline}` });
                }}
                style={{ opacity: deploying ? 0.3 : 1, padding: 6 }}
                activeOpacity={0.6}
              >
                <ShareIcon color={colors.textSecondary} size={22} />
              </TouchableOpacity>
            </View>
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

          {roomDetails && Object.keys(roomDetails).length > 0 && !deploying && (
            <View style={[styles.detailsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.detailsTitle, { color: colors.text }]}>Project Metadata</Text>
              {Object.entries(roomDetails).map(([key, value]) => (
                <View key={key} style={styles.detailsRow}>
                  <Text style={[styles.detailsKey, { color: colors.textSecondary }]}>{key.replace(/_/g, ' ')}</Text>
                  <Text style={[styles.detailsValue, { color: colors.text }]}>
                    {Array.isArray(value) ? value.join(', ') : String(value)}
                  </Text>
                </View>
              ))}
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
  deployText: { color: '#047857', fontWeight: 'bold' },
  detailsCard: {
    padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 20,
  },
  detailsTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  detailsRow: { flexDirection: 'row', marginBottom: 6 },
  detailsKey: { fontSize: 13, fontWeight: '600', textTransform: 'capitalize', width: 120 },
  detailsValue: { fontSize: 13, flex: 1 },
});
