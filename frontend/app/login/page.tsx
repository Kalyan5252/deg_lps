"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, setSession } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token, user } = await api.login(email, name || undefined);
      setSession(token, user);
      router.replace("/");
    } catch (err: any) {
      setError(err.message || "Sign-in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-ink text-sm font-bold text-white">
            S
          </div>
          <span className="text-lg font-semibold tracking-tight">SQLForge</span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">
          Step into the on-call seat
        </h1>
        <p className="mt-1 text-sm text-sub">
          Learn SQL by resolving realistic production incidents with a senior
          engineer mentoring you.
        </p>

        <form onSubmit={submit} className="card mt-6 space-y-4 p-5">
          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              Display name <span className="text-sub">(optional)</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex"
              className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          {error && <p className="text-sm text-bad">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary w-full"
          >
            {loading ? "Signing in…" : "Enter the workbench"}
          </button>
          <p className="text-center text-xs text-sub">
            No password — we create your account on first sign-in.
          </p>
        </form>
      </div>
    </div>
  );
}
