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
import { needsThumbnail, requestStoryThumbnails } from "@/lib/story-thumb";

const thumbnailAttempted = new Set<string>();

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
  const [fetching, setFetching] = useState(false);
  // UI-12: `loading` is true from the first render after sign-in until the first
  // fetch finished — screens show their placeholders right away instead of
  // flashing an empty state (and Home no longer flips content → skeleton).
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loading = fetching || (!!user && loadedFor !== user.id);

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
    setFetching(true);
    await Promise.all([refreshVoices(), refreshStories(), refreshFamily()]);
    setFetching(false);
  }, [refreshVoices, refreshStories, refreshFamily]);

  const userId = user?.id;
  // PR #49: own stories without a card thumbnail yet are thumbnailed by the
  // server in small batches, once per story per session (no retry loops).
  useEffect(() => {
    if (!userId) return;
    const ids = stories
      .filter((s) => needsThumbnail(s, userId) && !thumbnailAttempted.has(s.id))
      .slice(0, 12)
      .map((s) => s.id);
    if (!ids.length) return;
    ids.forEach((id) => thumbnailAttempted.add(id));
    void requestStoryThumbnails(ids).then((items) => {
      if (!items.length) return;
      const byId = new Map(items.map((i) => [i.id, i]));
      setStories((prev) =>
        prev.map((s) => {
          const patch = byId.get(s.id);
          return patch ? { ...s, ...patch, thumbnail_source: patch.thumbnail_source } : s;
        }),
      );
    });
  }, [stories, userId]);

  useEffect(() => {
    if (userId) {
      refreshAll().then(() => setLoadedFor(userId));
    } else {
      setVoiceProfiles([]);
      setStories([]);
      setFamilyMembers([]);
    }
  }, [userId, refreshAll]);

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
