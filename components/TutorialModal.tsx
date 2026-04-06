import React from 'react';
import { StyleSheet, View, Text, Modal, Pressable, ScrollView, useColorScheme } from 'react-native';
import { Rocket, Sparkles, Users, X, ArrowRight } from 'lucide-react-native';
import Colors from '@/constants/Colors';

interface TutorialModalProps {
  visible: boolean;
  onClose: () => void;
}

export function TutorialModal({ visible, onClose }: TutorialModalProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet">
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>Welcome to AIMS</Text>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <X color={colors.text} size={24} />
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            App Idea Makers Space is an AI-powered multiplayer playground. Here is how to master it:
          </Text>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
             <View style={[styles.iconBox, { backgroundColor: '#dbeafe' }]}>
                <Users color="#3b82f6" size={24} />
             </View>
             <View style={styles.cardText}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>1. Multiplayer Brainstorming</Text>
                <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
                  Create a room or paste a Room ID to join your friends. Collaborate in real-time securely over Supabase.
                </Text>
             </View>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
             <View style={[styles.iconBox, { backgroundColor: '#fef3c7' }]}>
                <Sparkles color="#d97706" size={24} />
             </View>
             <View style={styles.cardText}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>2. Summon AI Personas</Text>
                <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
                  Don't brainstorm alone. Type things like "As a Developer..." or "As a Designer..." and hit the Sparkles button to bring custom Agents into your chat!
                </Text>
             </View>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
             <View style={[styles.iconBox, { backgroundColor: '#d1fae5' }]}>
                <Rocket color="#059669" size={24} />
             </View>
             <View style={styles.cardText}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>3. Right-Swipe to Deploy</Text>
                <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
                  From the Rooms list, SWIPE RIGHT on any active room. A Multi-Agent team will automatically scan your chat history and write a production Blueprint for your app!
                </Text>
             </View>
          </View>

          <Pressable style={[styles.primaryButton, { backgroundColor: colors.tint }]} onPress={onClose}>
             <Text style={styles.primaryButtonText}>Get Started</Text>
             <ArrowRight color="#ffffff" size={20} style={{ marginLeft: 8 }} />
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, marginTop: 10 },
  title: { fontSize: 22, fontWeight: 'bold' },
  closeButton: { padding: 4 },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 60 },
  subtitle: { fontSize: 16, lineHeight: 24, marginBottom: 24 },
  card: { flexDirection: 'row', padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 16, alignItems: 'center' },
  iconBox: { width: 48, height: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  cardText: { flex: 1 },
  cardTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
  cardDesc: { fontSize: 14, lineHeight: 20 },
  primaryButton: { flexDirection: 'row', height: 54, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 24 },
  primaryButtonText: { color: '#ffffff', fontSize: 18, fontWeight: 'bold' }
});
