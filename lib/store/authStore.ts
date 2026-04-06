import { create } from "zustand";
import { Session } from "@supabase/supabase-js";
import { supabase } from "../supabase";

interface AuthSlice {
  session: Session | null;
  initialized: boolean;
  setSession: (session: Session | null) => void;
  initialize: () => void;
  signOut: () => Promise<void>;
  updateUserMetadata: (displayName: string) => Promise<void>;
}

export const useAuthStore = create<AuthSlice>((set) => ({
  session: null,
  initialized: false,
  
  setSession: (session) => set({ session }),

  initialize: () => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      set({ session, initialized: true });
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session });
    });
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null });
  },

  updateUserMetadata: async (displayName: string) => {
    const { data: { user }, error } = await supabase.auth.updateUser({
      data: { display_name: displayName }
    });
    if (!error && user) {
       const { data: { session } } = await supabase.auth.getSession();
       set({ session });
    }
  }
}));
