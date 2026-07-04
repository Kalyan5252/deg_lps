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
  scenarioKey: string | null;
  active: boolean;
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
  const scenarioKey = (path?.match(/^\/scenario\/([^/?#]+)/) || [])[1] || null;
  const active = Boolean(trackId || scenarioKey);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (trackId && getToken()) {
      api.trackChatThread(trackId).then(setMessages).catch(() => {});
    } else if (scenarioKey && getToken()) {
      api.mentorThread(scenarioKey).then(setMessages).catch(() => {});
    } else {
      setMessages([]);
    }
  }, [trackId, scenarioKey]);

  const send = useCallback(
    async (text: string) => {
      const msg = text.trim();
      if (!msg || busy || !active) return;
      // Let the workbench know a prompt was sent, so it can reveal the agent
      // panel (where the reply streams in) even if the user had it collapsed.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("mentor:send"));
      }
      // push the user message + an empty assistant bubble we'll stream into
      setMessages((m) => [
        ...m,
        { role: "user", content: msg },
        { role: "assistant", content: "" },
      ]);
      setBusy(true);
      try {
        if (trackId) {
          await api.trackChatStream(trackId, msg, (delta) => {
            setMessages((m) => {
              const copy = [...m];
              const last = copy[copy.length - 1];
              copy[copy.length - 1] = { ...last, content: last.content + delta };
              return copy;
            });
          });
        } else if (scenarioKey) {
          const { reply } = await api.mentor(scenarioKey, msg);
          setMessages((m) => {
            const copy = [...m];
            copy[copy.length - 1] = { role: "assistant", content: reply };
            return copy;
          });
        }
      } catch (e: any) {
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = {
            role: "assistant",
            content: `_Error: ${e.message}_`,
          };
          return copy;
        });
      } finally {
        setBusy(false);
        // the mentor may have set/replaced the active question — let the
        // workbench refresh its Question panel.
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("mentor:done"));
        }
      }
    },
    [active, busy, scenarioKey, trackId]
  );

  const clear = useCallback(async () => {
    if (trackId) await api.trackChatClear(trackId).catch(() => {});
    setMessages([]);
  }, [trackId]);

  return (
    <MentorChatCtx.Provider
      value={{ trackId, scenarioKey, active, messages, busy, send, clear }}
    >
      {children}
    </MentorChatCtx.Provider>
  );
}
