"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearSession, getUser, getToken, api, User } from "@/lib/api";
import OllamaSetupModal from "@/components/OllamaSetupModal";

const NAV = [
  { href: "/", label: "Dashboard", icon: "▦" },
  { href: "/paths", label: "Learning Paths", icon: "◆" },
  { href: "/datasets", label: "Global Datasets", icon: "◍" },
  { href: "/tracks", label: "Custom Tracks", icon: "⬡" },
  { href: "/pipelines", label: "Pipelines", icon: "⇄" },
  { href: "/progress", label: "Progress", icon: "▲" },
  { href: "/history", label: "Scenario History", icon: "≣" },
  { href: "/settings", label: "Settings", icon: "⚙" },
  { href: "/reghunt", label: "RegHunt", icon: "🎯", priority: true },
];

const COLLAPSE_KEY = "sqlforge_nav_collapsed";

export default function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [showAiSetup, setShowAiSetup] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    const u = getUser();
    setUser(u);
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    setReady(true);

    // First-run: prompt to connect Ollama AI if no key yet (per-user dismiss).
    const dismissKey = `ollama_setup_dismissed_${u?.email || ""}`;
    if (localStorage.getItem(dismissKey) !== "1") {
      api
        .aiSettings()
        .then((s) => {
          if (!s.has_api_key) setShowAiSetup(true);
        })
        .catch(() => {});
    }
  }, [router]);

  function closeAiSetup() {
    if (user?.email) {
      localStorage.setItem(`ollama_setup_dismissed_${user.email}`, "1");
    }
    setShowAiSetup(false);
  }

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  if (!ready) return null;

  return (
    <div className="flex min-h-screen">
      <aside
        className={`flex shrink-0 flex-col border-r border-line bg-white transition-[width] duration-150 ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        <div
          className={`flex items-center py-4 ${
            collapsed ? "justify-center px-0" : "justify-between px-4"
          }`}
        >
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded bg-ink text-sm font-bold text-white">
                D
              </div>
              <div className="text-[15px] font-semibold tracking-tight">
                D.E.G
              </div>
            </div>
          )}
          <button
            onClick={toggle}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex h-7 w-7 items-center justify-center rounded-md text-sub hover:bg-canvas hover:text-ink"
          >
            <PanelLeftIcon open={!collapsed} />
          </button>
        </div>

        <nav className={collapsed ? "flex-1 px-2" : "flex-1 px-3"}>
          {NAV.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            const priority = (item as any).priority;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={`mb-0.5 flex items-center gap-3 rounded-md py-2 text-sm transition-colors ${
                  collapsed ? "justify-center px-0" : "px-3"
                } ${priority ? "mt-3" : ""} ${
                  priority
                    ? active
                      ? "bg-canvas font-semibold text-ink"
                      : "font-semibold text-ink hover:bg-canvas"
                    : active
                    ? "bg-canvas font-medium text-ink"
                    : "text-sub hover:bg-canvas hover:text-ink"
                }`}
              >
                <span
                  className={
                    priority
                      ? "w-6 text-center text-2xl leading-none"
                      : "w-6 text-center text-xl leading-none"
                  }
                >
                  {item.icon}
                </span>
                {!collapsed && item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-line p-3">
          {collapsed ? (
            <button
              onClick={() => {
                clearSession();
                router.replace("/login");
              }}
              title={`${user?.display_name} — sign out`}
              className="flex h-8 w-full items-center justify-center rounded-md bg-canvas text-xs font-semibold text-ink hover:bg-line"
            >
              {(user?.display_name || "?").charAt(0).toUpperCase()}
            </button>
          ) : (
            <>
              <div className="px-2 py-1 text-sm font-medium">
                {user?.display_name}
              </div>
              <div className="truncate px-2 text-xs text-sub">
                {user?.email}
              </div>
              <button
                className="btn mt-2 w-full"
                onClick={() => {
                  clearSession();
                  router.replace("/login");
                }}
              >
                Sign out
              </button>
            </>
          )}
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>

      {showAiSetup && user && (
        <OllamaSetupModal
          userName={user.display_name}
          onClose={closeAiSetup}
        />
      )}
    </div>
  );
}

function PanelLeftIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect
        x="1.5"
        y="2.5"
        width="13"
        height="11"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <line
        x1="6"
        y1="2.5"
        x2="6"
        y2="13.5"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      {open && <rect x="2.5" y="3.5" width="2.5" height="9" rx="1" fill="currentColor" />}
    </svg>
  );
}
