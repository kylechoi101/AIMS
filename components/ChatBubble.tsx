import React from 'react';
import { View, Text, StyleSheet, useColorScheme, TouchableOpacity } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import Markdown from 'react-native-markdown-display';
import { Message } from '@/lib/types';
import { Bot, User, RefreshCw } from 'lucide-react-native';
import Colors from '@/constants/Colors';

interface ChatBubbleProps {
  message: Message;
  isHost?: boolean;
  currentUserId?: string;
  onRegenerate?: (messageId: string, originalContent: string) => void;
}

export function ChatBubble({ message, isHost, currentUserId, onRegenerate }: ChatBubbleProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const isAgent = message.sender_type === 'agent';
  const isMe = !isAgent && message.sender_id === currentUserId;
  const isStreaming = isAgent && (message.content === '...' || message.content.startsWith('Building context'));

  return (
    <Animated.View
      entering={FadeInUp.duration(400).springify()}
      style={[
        styles.container,
        isMe ? styles.meContainer : styles.otherContainer
      ]}
    >
      {!isMe && (
        <View style={styles.nameHeader}>
           <Text style={[styles.nameText, { color: colors.textSecondary }]}>
             {isAgent ? `[${message.sender_name || 'Agent'}]` : message.sender_name || 'Anonymous'}
           </Text>
           {isHost && !isAgent && (
              <Text style={styles.hostBadge}>[Host]</Text>
           )}
        </View>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        {!isMe && isAgent && (
          <View style={[styles.avatar, { backgroundColor: colors.tint, opacity: 0.8 }]}>
            <Bot size={16} color="#ffffff" />
          </View>
        )}

        <View style={[
          styles.bubble,
          isMe ? [styles.meBubble, { backgroundColor: colors.tint }] : [styles.otherBubble, { backgroundColor: colors.card, borderColor: colors.border }],
          isAgent && [styles.agentBubble, { borderColor: colorScheme === 'dark' ? '#c4b5fd' : '#f59e0b', backgroundColor: colorScheme === 'dark' ? '#2e1065' : '#fef3c7' }]
        ]}>
          {isAgent ? (
            <Markdown style={{
              body: { color: colors.text, fontSize: 16, lineHeight: 22 },
              paragraph: { marginTop: 0, marginBottom: 0 },
              code_inline: { backgroundColor: colors.border, paddingHorizontal: 4, borderRadius: 4, color: '#ec4899' },
              strong: { color: colors.text, fontWeight: 'bold' },
              list_item: { color: colors.text, marginBottom: 2 }
            }}>
              {message.content}
            </Markdown>
          ) : (
            <Text style={[
              styles.text,
              isMe ? styles.meText : { color: colors.text }
            ]}>
              {message.content}
            </Text>
          )}

          {isAgent && !isStreaming && onRegenerate && (
            <TouchableOpacity
              onPress={() => onRegenerate(message.id, message.content)}
              style={[styles.regenButton, { borderColor: colorScheme === 'dark' ? '#6d28d9' : '#d97706' }]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.6}
            >
              <RefreshCw size={12} color={colorScheme === 'dark' ? '#a78bfa' : '#b45309'} />
              <Text style={[styles.regenText, { color: colorScheme === 'dark' ? '#a78bfa' : '#b45309' }]}>Rethink</Text>
            </TouchableOpacity>
          )}
        </View>

        {isMe && (
          <View style={[styles.avatar, { backgroundColor: colors.tint }]}>
            <User size={16} color="#ffffff" />
          </View>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 6,
    maxWidth: '85%'
  },
  meContainer: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  otherContainer: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  nameHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, marginLeft: 36 },
  nameText: { fontSize: 13, fontWeight: 'bold' },
  hostBadge: { fontSize: 12, fontWeight: 'bold', color: '#f59e0b', marginLeft: 4 },
  avatar: {
    width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginHorizontal: 8,
  },
  bubble: { padding: 14, borderRadius: 20, borderWidth: 1 },
  meBubble: { borderBottomRightRadius: 4, borderWidth: 0 },
  otherBubble: { borderBottomLeftRadius: 4 },
  agentBubble: { borderWidth: 2, borderBottomLeftRadius: 4 },
  text: { fontSize: 16, lineHeight: 22 },
  meText: { color: '#ffffff' },
  regenButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginTop: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  regenText: {
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 4,
  },
});
