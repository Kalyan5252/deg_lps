"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice-to-text via the Web Speech API with a keep-alive so it doesn't stop
 * after ~1s of silence (Chrome fires `onend` on a pause even when
 * continuous=true — we immediately restart while the user wants to keep going).
 */
export function useSpeechToText(onTranscript: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  const keepRef = useRef(false);
  const finalRef = useRef("");
  const cbRef = useRef(onTranscript);
  cbRef.current = onTranscript;

  useEffect(() => {
    const SR =
      typeof window !== "undefined" &&
      ((window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition);
    setSupported(!!SR);
  }, []);

  const begin = useCallback(() => {
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";

    rec.onresult = (e: any) => {
      let interim = "";
      let fin = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) fin += res[0].transcript;
        else interim += res[0].transcript;
      }
      if (fin) finalRef.current = (finalRef.current + " " + fin).trim();
      cbRef.current((finalRef.current + " " + interim).trim());
    };
    rec.onerror = (ev: any) => {
      // permission denied → really stop; transient errors → let onend restart
      if (ev?.error === "not-allowed" || ev?.error === "service-not-allowed") {
        keepRef.current = false;
        setListening(false);
      }
    };
    rec.onend = () => {
      if (keepRef.current) {
        // restart a fresh recogniser to keep listening across silence
        setTimeout(() => {
          if (keepRef.current) begin();
        }, 150);
      } else {
        setListening(false);
      }
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      /* already starting — ignore */
    }
  }, []);

  const start = useCallback(() => {
    finalRef.current = "";
    keepRef.current = true;
    setListening(true);
    begin();
  }, [begin]);

  const stop = useCallback(() => {
    keepRef.current = false;
    try {
      recRef.current?.stop();
    } catch {
      /* noop */
    }
    setListening(false);
  }, []);

  const toggle = useCallback(() => {
    if (keepRef.current) stop();
    else start();
  }, [start, stop]);

  useEffect(
    () => () => {
      keepRef.current = false;
      try {
        recRef.current?.abort();
      } catch {
        /* noop */
      }
    },
    []
  );

  return { supported, listening, toggle, start, stop };
}
