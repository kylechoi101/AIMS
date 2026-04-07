import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, FlatList, Pressable, TouchableOpacity, useColorScheme, ActivityIndicator, TextInput } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Plus, ChevronRight } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import Colors from '@/constants/Colors';
import { useChatStore, storage } from '@/lib/store/chatStore';
import { TutorialModal } from '@/components/TutorialModal';

export default function RoomsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  const { rooms, loadRooms, createRoom, joinRoom, leaveRoom } = useChatStore();
  const [loading, setLoading] = useState(true);
  const [joinId, setJoinId] = useState('');
  const [joining, setJoining] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  useEffect(() => {
    loadRooms().then(() => setLoading(false));
    const hasSeen = storage.getString('hasSeenTutorial');
    if (hasSeen !== 'true') {
      setShowTutorial(true);
    }
  }, []);

  const handleCloseTutorial = () => {
    storage.set('hasSeenTutorial', 'true');
    setShowTutorial(false);
  };

  const handleCreateRoom = async () => {
    try {
      const roomId = await createRoom(`Brainstorming Session`);
      if (roomId) {
        router.push(`/room/${roomId}`);
      } else {
        alert("Creation failed. Supabase might be blocking Inserts via RLS policies. Check your database!");
      }
    } catch(err: any) {
      alert("Error: " + err.message);
    }
  };

  const handleJoinRoom = async () => {
    if (!joinId.trim()) return;
    setJoining(true);
    const success = await joinRoom(joinId.trim());
    setJoining(false);
    if (success) {
      const targetId = joinId.trim();
      setJoinId('');
      router.push(`/room/${targetId}`);
    } else {
      alert("Room not found or you are already an active member!");
    }
  };

  const renderRightActions = (roomId: string) => {
    return (
      <Pressable 
        style={{ backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'flex-end', paddingHorizontal: 24, marginBottom: 12, borderRadius: 16, width: 100 }}
        onPress={() => leaveRoom(roomId)}
      >
        <Text style={{ color: '#fff', fontWeight: 'bold' }}>Leave</Text>
      </Pressable>
    );
  };

  const renderLeftActions = (roomId: string) => {
    return (
      <Pressable 
        style={{ backgroundColor: '#10b981', justifyContent: 'center', alignItems: 'flex-start', paddingHorizontal: 24, marginBottom: 12, borderRadius: 16, width: 100 }}
        onPress={() => router.push(`/deploy/${roomId}` as any)}
      >
        <Text style={{ color: '#fff', fontWeight: 'bold' }}>Deploy</Text>
      </Pressable>
    );
  };

  const renderRoom = ({ item }: { item: any }) => (
    <Swipeable 
      renderRightActions={() => renderRightActions(item.id)}
      renderLeftActions={() => renderLeftActions(item.id)}
    >
      <Pressable 
        style={({pressed}) => [
          styles.roomCard, 
          { backgroundColor: colors.card, borderColor: colors.border },
          pressed && styles.roomCardPressed
        ]}
        onPress={() => router.push(`/room/${item.id}`)}
      >
        <View style={styles.roomInfo}>
          <Text style={[styles.roomName, { color: colors.text }]}>{item.name}</Text>
          <Text style={[styles.roomMeta, { color: colors.textSecondary }]}>Hosted securely via Supabase</Text>
        </View>
        <ChevronRight size={20} color={colors.textSecondary} />
      </Pressable>
    </Swipeable>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {loading ? (
        <ActivityIndicator size="large" color={colors.tint} style={{ marginTop: 50 }} />
      ) : (
        <>
          <View style={[styles.joinContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TextInput 
              style={[styles.joinInput, { color: colors.text }]}
              placeholder="Paste Room ID here..."
              placeholderTextColor={colors.textSecondary}
              value={joinId}
              onChangeText={setJoinId}
            />
            <Pressable style={[styles.joinButton, { backgroundColor: colors.tint }]} onPress={handleJoinRoom} disabled={joining}>
              {joining ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.joinButtonText}>Join</Text>}
            </Pressable>
          </View>
          <FlatList
            data={rooms}
            keyExtractor={(item) => item.id}
            renderItem={renderRoom}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={<Text style={[styles.emptyText, { color: colors.textSecondary }]}>No idea rooms yet. Tap Plus to create.</Text>}
          />
        </>
      )}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.tint, shadowColor: colors.tint }]}
        onPress={handleCreateRoom}
        hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
        activeOpacity={0.7}
      >
        <Plus size={28} color="#ffffff" />
      </TouchableOpacity>
      
      <TutorialModal visible={showTutorial} onClose={handleCloseTutorial} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 100 },
  roomCard: {
    flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, marginBottom: 12, borderWidth: 1,
  },
  roomCardPressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  roomInfo: { flex: 1 },
  roomName: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  roomMeta: { fontSize: 14 },
  emptyText: { textAlign: 'center', marginTop: 40 },
  joinContainer: { flexDirection: 'row', margin: 16, padding: 8, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  joinInput: { flex: 1, height: 40, paddingHorizontal: 12 },
  joinButton: { paddingHorizontal: 16, height: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 8, marginLeft: 8 },
  joinButtonText: { color: '#fff', fontWeight: '600' },
  fab: {
    position: 'absolute', bottom: 24, right: 24, width: 64, height: 64, borderRadius: 32, 
    justifyContent: 'center', alignItems: 'center', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 5,
  }
});
