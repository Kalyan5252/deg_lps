"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { api, getToken } from "@/lib/api";

export type Msg = { role: string; content: string };

type Ctx = {
  trackId: string | null;
  messages: Msg[];
  busy: boolean;
  send: (text: string) => Promise<void>;
  clear: () => Promise<void>;
};

const MentorChatCtx = createContext<Ctx | null>(null);

export function useMentorChat(): Ctx {
  const c = useContext(MentorChatCtx);
  if (!c) throw new Error("useMentorChat must be used within MentorChatProvider");
  return c;
}

/**
 * One conversation shared between the floating prompt component (input only)
 * and the right-side chat window (where messages are shown).
 */
export function MentorChatProvider({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const trackId = (path?.match(/^\/tracks\/(\d+)/) || [])[1] || null;

  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (trackId && getToken()) {
      api.trackChatThread(trackId).then(setMessages).catch(() => {});
    } else {
      setMessages([]);
    }
  }, [trackId]);

  const send = useCallback(
    async (text: string) => {
      const msg = text.trim();
      if (!msg || busy || !trackId) return;
      setMessages((m) => [...m, { role: "user", content: msg }]);
      setBusy(true);
      try {
        const { reply } = await api.trackChat(trackId, msg);
        setMessages((m) => [...m, { role: "assistant", content: reply }]);
      } catch (e: any) {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: `_Error: ${e.message}_` },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, trackId]
  );

  const clear = useCallback(async () => {
    if (trackId) await api.trackChatClear(trackId).catch(() => {});
    setMessages([]);
  }, [trackId]);

  return (
    <MentorChatCtx.Provider value={{ trackId, messages, busy, send, clear }}>
      {children}
    </MentorChatCtx.Provider>
  );
}
