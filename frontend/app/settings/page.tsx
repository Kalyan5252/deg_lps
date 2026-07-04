"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api, AISettings } from "@/lib/api";

const DEFAULT_MODEL = "gemma4:31b-cloud";
const DEFAULT_BASE_URL = "https://ollama.com";

export default function SettingsPage() {
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .aiSettings()
      .then((s) => {
        if (!alive) return;
        setSettings(s);
        setModel(s.model || DEFAULT_MODEL);
        setBaseUrl(s.base_url || DEFAULT_BASE_URL);
        setEnabled(s.provider === "platform_default" ? true : s.enabled);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await api.saveAISettings({
        provider: "ollama_cloud",
        base_url: baseUrl.trim() || DEFAULT_BASE_URL,
        model: model.trim() || DEFAULT_MODEL,
        api_key: apiKey.trim() || undefined,
        enabled,
      });
      setSettings(saved);
      setApiKey("");
      setMessage(`Ollama Cloud is active. We will use ${saved.model} for your AI usage.`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await api.disableAISettings();
      setSettings(saved);
      setEnabled(false);
      setMessage("Personal Ollama Cloud usage is disabled. Platform default AI will be used.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const usingPersonal = settings?.provider === "ollama_cloud" && settings.enabled;
  const currentModel = usingPersonal ? settings?.model : DEFAULT_MODEL;

  return (
    <Shell>
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-sub">
            Connect your Ollama Cloud API key so mentor chat, reviews, generated
            questions, RegHunt, and pipeline AI use your own account.
          </p>
        </div>

        <section className="rounded-lg border border-line bg-white">
          <div className="border-b border-line px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold">Ollama Cloud</h2>
                <p className="mt-1 text-sm text-sub">
                  We will use <span className="font-mono text-ink">{currentModel}</span>{" "}
                  for your AI requests when this is enabled.
                </p>
              </div>
              <span
                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                  usingPersonal
                    ? "border-ok/30 bg-ok/10 text-ok"
                    : "border-line bg-canvas text-sub"
                }`}
              >
                {usingPersonal ? "Using your key" : "Platform default"}
              </span>
            </div>
          </div>

          <div className="grid gap-5 p-5 md:grid-cols-[1fr_280px]">
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">
                  Ollama API key
                </span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    settings?.has_api_key
                      ? `Saved key ${settings.api_key_mask || "is configured"}`
                      : "Paste your Ollama API key"
                  }
                  className="w-full rounded-md border border-line bg-white px-3 py-2 font-mono text-sm outline-none focus:border-accent"
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">
                    Model
                  </span>
                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={DEFAULT_MODEL}
                    className="w-full rounded-md border border-line bg-white px-3 py-2 font-mono text-sm outline-none focus:border-accent"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">
                    Host
                  </span>
                  <input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={DEFAULT_BASE_URL}
                    className="w-full rounded-md border border-line bg-white px-3 py-2 font-mono text-sm outline-none focus:border-accent"
                  />
                </label>
              </div>

              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-4 w-4 accent-accent"
                />
                Use this Ollama Cloud account for my AI usage
              </label>

              {error && (
                <div className="rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">
                  {error}
                </div>
              )}
              {message && (
                <div className="rounded-md border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok">
                  {message}
                </div>
              )}
            </div>

            <aside className="rounded-lg border border-line bg-canvas p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-sub">
                What changes
              </div>
              <div className="mt-3 space-y-3 text-sm text-ink">
                <p>Your API key stays on the backend and is never shown again.</p>
                <p>
                  If enabled, AI calls use <span className="font-mono">{model || DEFAULT_MODEL}</span>{" "}
                  through Ollama Cloud.
                </p>
                <p>
                  If the key is disabled or missing, the app falls back to the platform
                  default model.
                </p>
              </div>
            </aside>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
            <button className="btn" onClick={disable} disabled={busy || !settings?.has_api_key}>
              Disable personal key
            </button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              {busy ? "Saving..." : "Save Ollama settings"}
            </button>
          </div>
        </section>
      </div>
    </Shell>
  );
}
