export type AgentRole = 'designer' | 'developer' | 'researcher' | 'advisor';

export type Message = {
  id: string;
  room_id: string;
  sender_id: string | null;
  sender_type: 'user' | 'agent';
  sender_name?: string;
  content: string;
  created_at: string;
};

export type ChimeParams = {
  roomId: string;
  recentMessages: Message[];
};

export type Room = {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  is_locked?: boolean;
  invite_code?: string;
};
