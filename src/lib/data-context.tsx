"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useAuth } from "@/lib/auth-context";
import {
  getVoiceProfiles,
  getStories,
  getFamilyMembers,
  type VoiceProfileRow,
  type StoryRow,
  type FamilyMemberRow,
} from "@/lib/db";

interface DataContextValue {
  voiceProfiles: VoiceProfileRow[];
  stories: StoryRow[];
  familyMembers: FamilyMemberRow[];
  loading: boolean;
  refreshVoices: () => Promise<void>;
  refreshStories: () => Promise<void>;
  refreshFamily: () => Promise<void>;
  refreshAll: () => Promise<void>;
}

const DataContext = createContext<DataContextValue>({
  voiceProfiles: [],
  stories: [],
  familyMembers: [],
  loading: false,
  refreshVoices: async () => {},
  refreshStories: async () => {},
  refreshFamily: async () => {},
  refreshAll: async () => {},
});

export function useData() {
  return useContext(DataContext);
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [voiceProfiles, setVoiceProfiles] = useState<VoiceProfileRow[]>([]);
  const [stories, setStories] = useState<StoryRow[]>([]);
  const [familyMembers, setFamilyMembers] = useState<FamilyMemberRow[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshVoices = useCallback(async () => {
    try {
      setVoiceProfiles(await getVoiceProfiles());
    } catch {
      /* ignore */
    }
  }, []);

  const refreshStories = useCallback(async () => {
    try {
      setStories(await getStories());
    } catch {
      /* ignore */
    }
  }, []);

  const refreshFamily = useCallback(async () => {
    try {
      setFamilyMembers(await getFamilyMembers());
    } catch {
      /* ignore */
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([refreshVoices(), refreshStories(), refreshFamily()]);
    setLoading(false);
  }, [refreshVoices, refreshStories, refreshFamily]);

  useEffect(() => {
    if (user) {
      refreshAll();
    } else {
      setVoiceProfiles([]);
      setStories([]);
      setFamilyMembers([]);
    }
  }, [user, refreshAll]);

  return (
    <DataContext.Provider
      value={{
        voiceProfiles,
        stories,
        familyMembers,
        loading,
        refreshVoices,
        refreshStories,
        refreshFamily,
        refreshAll,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}
