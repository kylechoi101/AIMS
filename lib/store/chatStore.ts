import { create } from "zustand";
import { createMMKV } from "react-native-mmkv";
import { Platform } from "react-native";
import { Message, Room, RoomStatus } from "../types";
import { supabase } from "../supabase";

// Safe MMKV initialization — falls back gracefully if native module isn't ready
const webStorage = {
  set: (k: string, v: string) => typeof window !== 'undefined' && window.localStorage.setItem(k, v),
  getString: (k: string) => typeof window !== 'undefined' ? window.localStorage.getItem(k) : null,
  remove: (k: string) => typeof window !== 'undefined' && window.localStorage.removeItem(k)
};

let storage: any;
export { storage };
if (Platform.OS === 'web') {
  storage = webStorage;
} else {
  try {
    storage = createMMKV({ id: 'chat-store' });
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
// @ts-ignore

interface ChatSlice {
  rooms: Room[];
  messages: Message[];
  activeRoom: string | null;
  offlineQueue: Message[];
  
  hasMore: boolean;
  lastCursor: string | null;
  
  loadRooms: () => Promise<void>;
  createRoom: (name: string) => Promise<string | null>;
  joinRoom: (roomId: string) => Promise<boolean>;
  leaveRoom: (roomId: string) => Promise<void>;
  updateRoomName: (roomId: string, newName: string) => Promise<void>;
  updateRoomLock: (roomId: string, locked: boolean) => Promise<void>;
  updateRoomStatus: (roomId: string, status: RoomStatus) => Promise<void>;
  updateRoomDetails: (roomId: string, details: Record<string, any>) => Promise<void>;
  regenerateInviteCode: (roomId: string) => Promise<void>;
  loadMessages: (roomId: string, cursor?: string) => Promise<void>;
  addMessage: (msg: Message) => void;
  updateMessage: (id: string, partial: Partial<Message>) => void;
  removeMessage: (id: string) => void;
  queueMessage: (msg: Message) => void;
  flushQueue: () => Promise<void>;
  subscribeToRoom: (roomId: string) => void;
}

export const useChatStore = create<ChatSlice>((set, get) => ({
  rooms: [],
  messages: [],
  activeRoom: null,
  offlineQueue: [],
  hasMore: true,
  lastCursor: null,

  loadRooms: async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    // Only load rooms where the current user is an active member.
    // This prevents left rooms from reappearing on refresh.
    const { data: memberRows } = await supabase
      .from('room_members')
      .select('room_id')
      .eq('user_id', userData.user.id);

    if (!memberRows || memberRows.length === 0) {
      set({ rooms: [] });
      return;
    }

    const roomIds = memberRows.map((r: any) => r.room_id);
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .in('id', roomIds)
      .order('created_at', { ascending: false });

    if (!error && data) {
      set({ rooms: data as Room[] });
    }
  },

  createRoom: async (name: string) => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return null;

    const { data, error } = await supabase.from('rooms')
       .insert([{ name, created_by: userData.user.id }])
       .select()
       .single();

    if (!error && data) {
       // Automatically add host to room_members to satisfy RLS if table exists
       await supabase.from('room_members').insert([{ room_id: data.id, user_id: userData.user.id }]);
       set((state) => ({ rooms: [data as Room, ...state.rooms] }));
       return data.id;
    }
    console.error("Supabase Create Room Error: ", error);
    return null;
  },

  updateRoomName: async (roomId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    
    set((state) => ({
      rooms: state.rooms.map(r => r.id === roomId ? { ...r, name: trimmed } : r)
    }));

    const { error } = await supabase.from('rooms').update({ name: trimmed }).eq('id', roomId);
    if (error) console.error("Failed to rename room:", error);
  },

  updateRoomLock: async (roomId: string, locked: boolean) => {
    set((state) => ({
      rooms: state.rooms.map(r => r.id === roomId ? { ...r, is_locked: locked } : r)
    }));
    const { error } = await supabase.from('rooms').update({ is_locked: locked }).eq('id', roomId);
    if (error) console.log("Postgres Warning: Need to add 'is_locked' column to rooms table.", error);
  },

  updateRoomStatus: async (roomId: string, status: RoomStatus) => {
    set((state) => ({
      rooms: state.rooms.map(r => r.id === roomId ? { ...r, status } : r)
    }));
    await supabase.from('rooms').update({ status }).eq('id', roomId);
  },

  updateRoomDetails: async (roomId: string, details: Record<string, any>) => {
    set((state) => ({
      rooms: state.rooms.map(r => r.id === roomId ? { ...r, details: { ...(r.details || {}), ...details } } : r)
    }));
    // Merge with existing details on the server
    const { data: existing } = await supabase.from('rooms').select('details').eq('id', roomId).single();
    const merged = { ...(existing?.details || {}), ...details };
    await supabase.from('rooms').update({ details: merged }).eq('id', roomId);
  },

  regenerateInviteCode: async (roomId: string) => {
    const inviteCode = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
    set((state) => ({
      rooms: state.rooms.map(r => r.id === roomId ? { ...r, invite_code: inviteCode } : r)
    }));
    await supabase.from('rooms').update({ invite_code: inviteCode }).eq('id', roomId);
  },

  joinRoom: async (roomId: string) => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return false;
    
    const { data: roomEx } = await supabase.from('rooms')
       .select('*')
       .or(`id.eq.${roomId},invite_code.eq.${roomId}`)
       .single();
    if (!roomEx || roomEx.is_locked) return false;

    // Supabase will naturally reject if already exist, or insert successfully
    await supabase.from('room_members').insert({ room_id: roomEx.id, user_id: userData.user.id });
    
    const isAlreadyThere = get().rooms.find(r => r.id === roomEx.id);
    if (!isAlreadyThere) {
      set((state) => ({ rooms: [roomEx as Room, ...state.rooms] }));
    }
    return true;
  },

  leaveRoom: async (roomId: string) => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    
    set((state) => ({ rooms: state.rooms.filter(r => r.id !== roomId) }));
    await supabase.from('room_members').delete().match({ room_id: roomId, user_id: userData.user.id });
  },

  loadMessages: async (roomId: string, cursor?: string) => {
    set({ activeRoom: roomId });
    
    let query = supabase.from('messages').select('*').eq('room_id', roomId).order('created_at', { ascending: false }).limit(50);
    
    if (cursor) query = query.lt('created_at', cursor);

    const { data, error } = await query;
    if (!error && data) {
      set((state) => {
        const sortedData = data as Message[];
        return { 
          messages: cursor ? [...state.messages, ...sortedData] : sortedData,
          hasMore: data.length === 50,
          lastCursor: data.length > 0 ? data[data.length - 1].created_at : state.lastCursor
        }
      });
    }
  },

  addMessage: (msg: Message) => {
    set((state) => {
      if (state.messages.find(m => m.id === msg.id)) return state;
      // Index 0 represents the Bottom of inverted lists
      return { messages: [msg, ...state.messages] };
    });
  },

  updateMessage: (id: string, partial: Partial<Message>) => {
    set((state) => ({
      messages: state.messages.map(m => m.id === id ? { ...m, ...partial } : m)
    }));
  },

  removeMessage: (id: string) => {
    set((state) => ({
      messages: state.messages.filter(m => m.id !== id)
    }));
  },

  queueMessage: (msg: Message) => {
    const { offlineQueue } = get();
    const newQueue = [...offlineQueue, msg];
    storage.set('offlineQueue', JSON.stringify(newQueue));
    set({ offlineQueue: newQueue });
    
    get().addMessage(msg); // Add to UI immediately

    // Send immediately
    supabase.from('messages').insert({
      id: msg.id,
      room_id: msg.room_id,
      sender_id: msg.sender_id,
      sender_type: msg.sender_type,
      sender_name: msg.sender_name,
      content: msg.content,
      created_at: msg.created_at
    }).then(({ error }) => {
      if (!error) {
        get().flushQueue(); // Clear queue if successful
      }
    });
  },

  flushQueue: async () => {
    // Basic flush strategy: If we reach here, local network is working.
    set({ offlineQueue: [] });
    storage.remove('offlineQueue');
  },

  subscribeToRoom: (roomId: string) => {
    supabase.removeAllChannels();

    supabase
      .channel(`room:${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, (payload) => {
         const msg = payload.new as Message;
         get().addMessage(msg);
      })
      .subscribe();
  }
}));
