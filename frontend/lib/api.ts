"use client";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000/api";

const TOKEN_KEY = "sqlforge_token";
const USER_KEY = "sqlforge_user";

export type User = { id: number; email: string; display_name: string };

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): User | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as User) : null;
}

export function setSession(token: string, user: User) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function request<T>(
  path: string,
  opts: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (res.status === 401) {
    clearSession();
    if (typeof window !== "undefined" && !path.includes("/auth/login")) {
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      /* noop */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export const api = {
  login: (email: string, display_name?: string) =>
    request<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, display_name }),
    }),
  paths: () => request<any[]>("/paths"),
  scenarios: () => request<any[]>("/scenarios"),
  scenario: (key: string) => request<any>(`/scenarios/${key}`),
  reset: (key: string) =>
    request<any>(`/scenarios/${key}/reset`, { method: "POST" }),
  run: (scenario_key: string, sql: string) =>
    request<any>("/workbench/run", {
      method: "POST",
      body: JSON.stringify({ scenario_key, sql }),
    }),
  explain: (scenario_key: string, sql: string, analyze = true) =>
    request<any>("/workbench/explain", {
      method: "POST",
      body: JSON.stringify({ scenario_key, sql, analyze }),
    }),
  submit: (scenario_key: string, sql: string) =>
    request<any>("/workbench/submit", {
      method: "POST",
      body: JSON.stringify({ scenario_key, sql }),
    }),
  history: (scenario_key: string) =>
    request<any[]>(`/workbench/history?scenario_key=${scenario_key}`),
  mentor: (
    scenario_key: string,
    message: string,
    current_sql?: string,
    last_result?: any
  ) =>
    request<{ reply: string }>("/mentor", {
      method: "POST",
      body: JSON.stringify({ scenario_key, message, current_sql, last_result }),
    }),
  mentorThread: (scenario_key: string) =>
    request<any[]>(`/mentor/${scenario_key}`),
  progress: () => request<any>("/progress"),
  attempts: () => request<any[]>("/history"),
};
