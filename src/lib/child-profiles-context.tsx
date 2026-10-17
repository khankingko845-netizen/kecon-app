"use client";

/**
 * T10 · Hồ sơ bé (docs/child-profiles.md): the household's child profiles (1–5) and the
 * child chosen on this device ("bé đang nghe"). Reads/writes go through the parent's own
 * session — RLS + the migration 044 guard decide the household, the creator, the limit
 * and consent; this context only mirrors the result.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import {
  CHILD_PROFILE_COLUMNS,
  DB_MAX_AGE,
  activeChildKey,
  childAge,
  childErrorMessage,
  parsePendingChild,
  pendingChildKey,
  pickActiveChild,
  validateChildDraft,
  type ChildDraft,
  type ChildProfile,
} from "@/lib/child-profiles";

export type ChildSaveResult =
  | { ok: true; child: ChildProfile }
  | { ok: false; message: string; field?: "name" | "birthYear" | "interests" };

interface ChildProfilesValue {
  kids: ChildProfile[];
  /** The first load for the signed-in account has finished (successfully or not). */
  loaded: boolean;
  loadError: boolean;
  activeChild: ChildProfile | null;
  /** A signup draft is waiting for the parent's consent on this device. */
  pendingDraft: boolean;
  setActiveChild: (id: string) => void;
  addChild: (draft: ChildDraft) => Promise<ChildSaveResult>;
  updateChild: (id: string, draft: ChildDraft) => Promise<ChildSaveResult>;
  removeChild: (id: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  reload: () => Promise<void>;
  /** Signup draft → first child profile, once the parent has consented (T11). */
  flushPending: () => Promise<void>;
}

const noop = async () => {};
const ChildProfilesContext = createContext<ChildProfilesValue>({
  kids: [],
  loaded: false,
  loadError: false,
  activeChild: null,
  pendingDraft: false,
  setActiveChild: () => {},
  addChild: async () => ({ ok: false, message: "" }),
  updateChild: async () => ({ ok: false, message: "" }),
  removeChild: async () => ({ ok: false, message: "" }),
  reload: noop,
  flushPending: noop,
});

export function useChildProfiles(): ChildProfilesValue {
  return useContext(ChildProfilesContext);
}

const readStore = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeStore = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode: the choice lasts for this session only */
  }
};

const asChild = (row: ChildProfile): ChildProfile => ({ ...row, interests: Array.isArray(row.interests) ? row.interests : [] });

interface State {
  uid: string | null;
  kids: ChildProfile[];
  loaded: boolean;
  loadError: boolean;
  /** Child chosen on this device (localStorage), if any. */
  activeId: string | null;
  pendingDraft: boolean;
}

const EMPTY: State = { uid: null, kids: [], loaded: false, loadError: false, activeId: null, pendingDraft: false };

export function ChildProfilesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const [state, setState] = useState<State>(EMPTY);
  const flushing = useRef(false);
  const uidRef = useRef(uid);
  useEffect(() => {
    uidRef.current = uid;
  }, [uid]);

  /** Apply a change only while the same account is signed in. */
  const patch = useCallback((forUid: string, change: (prev: State) => Partial<State>) => {
    setState((prev) => (prev.uid === forUid ? { ...prev, ...change(prev) } : prev));
  }, []);

  const load = useCallback(async (forUid: string) => {
    const { data, error } = await createClient()
      .from("child_profiles")
      .select(CHILD_PROFILE_COLUMNS)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (uidRef.current !== forUid) return;
    setState((prev) => {
      const same = prev.uid === forUid;
      return {
        uid: forUid,
        kids: error ? (same ? prev.kids : []) : ((data ?? []) as ChildProfile[]).map(asChild),
        loaded: true,
        loadError: Boolean(error),
        activeId: readStore(activeChildKey(forUid)),
        pendingDraft: parsePendingChild(readStore(pendingChildKey(forUid))) !== null,
      };
    });
  }, []);

  useEffect(() => {
    if (uid) void load(uid);
  }, [uid, load]);

  const current = state.uid === uid ? state : EMPTY;
  const kids = current.kids;
  const activeChild = useMemo(() => pickActiveChild(kids, current.activeId), [kids, current.activeId]);

  const setActiveChild = useCallback(
    (id: string) => {
      if (!uid) return;
      writeStore(activeChildKey(uid), id);
      patch(uid, () => ({ activeId: id }));
    },
    [uid, patch],
  );

  const addChild = useCallback(
    async (draft: ChildDraft): Promise<ChildSaveResult> => {
      if (!uid) return { ok: false, message: "Bạn cần đăng nhập lại." };
      const checked = validateChildDraft(draft);
      if (!checked.ok) return checked;
      const { data, error } = await createClient().from("child_profiles").insert(checked.value).select(CHILD_PROFILE_COLUMNS).single();
      if (error || !data) return { ok: false, message: childErrorMessage(error) };
      const child = asChild(data as ChildProfile);
      patch(uid, (prev) => ({ kids: [...prev.kids, child] }));
      return { ok: true, child };
    },
    [uid, patch],
  );

  const updateChild = useCallback(
    async (id: string, draft: ChildDraft): Promise<ChildSaveResult> => {
      if (!uid) return { ok: false, message: "Bạn cần đăng nhập lại." };
      const checked = validateChildDraft(draft);
      if (!checked.ok) return checked;
      // `.select` so an update that matched no row (RLS / already deleted) is not reported as saved.
      const { data, error } = await createClient().from("child_profiles").update(checked.value).eq("id", id).select(CHILD_PROFILE_COLUMNS);
      const row = (data as ChildProfile[] | null)?.[0];
      if (error || !row) return { ok: false, message: childErrorMessage(error) };
      const child = asChild(row);
      patch(uid, (prev) => ({ kids: prev.kids.map((k) => (k.id === id ? child : k)) }));
      return { ok: true, child };
    },
    [uid, patch],
  );

  const removeChild = useCallback(
    async (id: string): Promise<{ ok: true } | { ok: false; message: string }> => {
      if (!uid) return { ok: false, message: "Bạn cần đăng nhập lại." };
      const { data, error } = await createClient().from("child_profiles").delete().eq("id", id).select("id");
      if (error || !data?.length) return { ok: false, message: error ? childErrorMessage(error) : "Hồ sơ bé này không còn nữa." };
      if (readStore(activeChildKey(uid)) === id) writeStore(activeChildKey(uid), null);
      patch(uid, (prev) => ({ kids: prev.kids.filter((k) => k.id !== id), activeId: prev.activeId === id ? null : prev.activeId }));
      return { ok: true };
    },
    [uid, patch],
  );

  const reload = useCallback(async () => {
    if (uid) await load(uid);
  }, [uid, load]);

  const flushPending = useCallback(async () => {
    if (!uid || flushing.current) return;
    const key = pendingChildKey(uid);
    const draft = parsePendingChild(readStore(key));
    if (!draft) {
      writeStore(key, null);
      patch(uid, () => ({ pendingDraft: false }));
      return;
    }
    flushing.current = true;
    try {
      const supabase = createClient();
      // Only a household without children takes the signup draft.
      const { data: existing, error: readError } = await supabase.from("child_profiles").select("id").limit(1);
      if (readError) return; // try again on the next app start
      if (!existing?.length) {
        const age = childAge(draft.birthYear);
        const row = { display_name: draft.displayName, birth_year: age !== null && age <= DB_MAX_AGE ? draft.birthYear : null, interests: [] };
        const { data, error } = await supabase.from("child_profiles").insert(row).select(CHILD_PROFILE_COLUMNS).single();
        if (error || !data) {
          // Consent not active yet or a network/server problem → keep the draft for later;
          // a draft the guard rejects (name/year/limit) is dropped — the parent adds the child by hand.
          if (!error || !/invalid_child_name|invalid_birth_year|child_profile_limit/.test(error.message ?? "")) return;
        } else {
          const child = asChild(data as ChildProfile);
          patch(uid, (prev) => ({ kids: prev.kids.some((k) => k.id === child.id) ? prev.kids : [...prev.kids, child] }));
        }
      }
      writeStore(key, null);
      patch(uid, () => ({ pendingDraft: false }));
      if (existing?.length) await load(uid);
    } finally {
      flushing.current = false;
    }
  }, [uid, load, patch]);

  const value = useMemo<ChildProfilesValue>(
    () => ({
      kids,
      loaded: current.loaded,
      loadError: current.loadError,
      activeChild,
      pendingDraft: current.pendingDraft,
      setActiveChild,
      addChild,
      updateChild,
      removeChild,
      reload,
      flushPending,
    }),
    [kids, current.loaded, current.loadError, current.pendingDraft, activeChild, setActiveChild, addChild, updateChild, removeChild, reload, flushPending],
  );

  return <ChildProfilesContext.Provider value={value}>{children}</ChildProfilesContext.Provider>;
}
