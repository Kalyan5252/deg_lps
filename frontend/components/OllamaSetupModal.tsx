"use client";

import { useState } from "react";
import { api } from "@/lib/api";

const OLLAMA_URL = "https://ollama.com";
const OLLAMA_KEYS_URL = "https://ollama.com/settings/keys";

/**
 * First-run onboarding modal: walks a new user through creating an Ollama Cloud
 * API key and saving it, so the AI mentor works from the start. Compact, centered,
 * dark backdrop — steps on the left, a looping demo video on the right.
 */
export default function OllamaSetupModal({
  userName,
  onClose,
}: {
  userName: string;
  onClose: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!apiKey.trim()) {
      setErr("Paste your Ollama API key first.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await api.saveAISettings({
        provider: "ollama_cloud",
        base_url: "https://ollama.com",
        model: "gemma4:31b-cloud",
        api_key: apiKey.trim(),
        enabled: true,
      });
      onClose();
    } catch (e: any) {
      setErr(e.message || "Could not save the key.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-white shadow-2xl">
        <div className="grid md:grid-cols-2">
          {/* left — steps + key */}
          <div className="flex flex-col p-6">
            <h2 className="text-lg font-semibold text-ink">
              Welcome, {userName} 👋
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-sub">
              Learn SQL &amp; data engineering with an AI mentor at your side.
              Before you start, let&apos;s connect your AI.
            </p>

            <ol className="mt-4 space-y-2 text-[13px] text-ink">
              <li>
                <span className="font-medium">1.</span> Open{" "}
                <a
                  href={OLLAMA_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-accent hover:underline"
                >
                  ollama.com
                </a>{" "}
                and sign in (or create an account).
              </li>
              <li>
                <span className="font-medium">2.</span> Go to{" "}
                <a
                  href={OLLAMA_KEYS_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-accent hover:underline"
                >
                  Settings → Keys
                </a>
                .
              </li>
              <li>
                <span className="font-medium">3.</span> Generate an API key.
              </li>
              <li>
                <span className="font-medium">4.</span> Copy it and paste it
                below.
              </li>
            </ol>

            <div className="mt-4">
              <input
                type="password"
                className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
                placeholder="Paste your Ollama API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
              />
              {err && <p className="mt-1 text-[11px] text-bad">{err}</p>}
            </div>

            <div className="mt-4 flex items-center justify-between">
              <button
                className="text-xs text-sub hover:text-ink"
                onClick={onClose}
              >
                Skip for now
              </button>
              <button
                className="btn btn-primary"
                onClick={save}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save & continue"}
              </button>
            </div>
          </div>

          {/* right — looping demo video */}
          <div className="hidden bg-canvas md:block">
            <video
              src="/videos/ollama_api_key_demo.mp4"
              autoPlay
              loop
              muted
              playsInline
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
