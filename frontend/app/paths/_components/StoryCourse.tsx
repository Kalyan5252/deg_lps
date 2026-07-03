"use client";

import Link from "next/link";
import { useState } from "react";

export type StoryCourseSlide = {
  eyebrow: string;
  title: string;
  body: string;
  accent?: string;
  example?: string;
};

export default function StoryCourse({
  title,
  slides,
}: {
  title: string;
  slides: StoryCourseSlide[];
}) {
  const [index, setIndex] = useState(0);
  const current = slides[index];
  const progress = Math.round(((index + 1) / slides.length) * 100);

  function go(next: number) {
    setIndex(Math.max(0, Math.min(slides.length - 1, next)));
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[#0b0d11] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(47,109,246,0.38),transparent_34%),radial-gradient(circle_at_76%_24%,rgba(150,58,210,0.28),transparent_30%),linear-gradient(135deg,#090a0d_0%,#101721_56%,#08111a_100%)]" />
      <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:48px_48px]" />

      <div className="relative flex min-h-screen flex-col">
        <div className="course-rise relative z-[100] flex items-start justify-between px-8 py-5">
          <Link href="/paths" className="text-sm text-white/60 hover:text-white">
            Exit course
          </Link>
          <div className="flex items-start gap-4">
            <div className="group relative">
              <button className="min-w-56 rounded-md border border-white/10 bg-white/10 px-3 py-2 text-left backdrop-blur transition-colors hover:bg-white/15">
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">
                  Current screen
                </div>
                <div className="mt-0.5 truncate text-sm font-medium text-white">
                  {current.title}
                </div>
              </button>
              <div className="invisible absolute right-0 top-full z-50 mt-3 max-h-[52vh] w-72 translate-y-2 overflow-auto rounded-lg border border-white/25 bg-[#050912] p-2 opacity-0 shadow-[0_28px_90px_rgba(0,0,0,0.82)] ring-1 ring-black transition-all duration-200 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
                {slides.map((s, i) => (
                  <button
                    key={`${s.title}-${i}`}
                    onClick={() => go(i)}
                    className={`block w-full rounded-md px-3 py-2 text-left transition-colors ${
                      i === index
                        ? "bg-white text-ink"
                        : "text-white/70 hover:bg-white/10"
                    }`}
                  >
                    <div className="text-[10px] uppercase tracking-[0.2em] opacity-60">
                      Screen {i + 1}
                    </div>
                    <div className="truncate text-sm font-medium">{s.title}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="w-56">
              <div className="mb-1 flex justify-between text-xs text-white/50">
                <span>
                  Screen {index + 1}/{slides.length}
                </span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-white transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <main className="flex flex-1 items-center justify-center px-8 pb-16">
          <section className="mx-auto max-w-5xl text-center">
            <div className="course-rise text-sm font-semibold uppercase tracking-[0.32em] text-blue-200/80">
              {current.eyebrow}
            </div>
            <h1 className="course-rise course-rise-delay-1 mt-6 text-5xl font-semibold leading-tight tracking-normal md:text-7xl">
              {current.title}
            </h1>
            <p className="course-rise course-rise-delay-2 mx-auto mt-8 max-w-4xl text-xl leading-9 text-white/72">
              {current.body}
            </p>
            {current.example && (
              <div className="course-rise course-rise-delay-3 mx-auto mt-8 max-w-3xl rounded-lg border border-white/10 bg-black/35 p-5 text-left font-mono text-sm leading-7 text-emerald-100">
                {current.example}
              </div>
            )}
            {current.accent && (
              <p className="course-rise course-rise-delay-4 mt-6 font-serif text-2xl italic text-white">
                {current.accent}
              </p>
            )}
            <div className="course-rise course-rise-delay-5 mt-12 flex justify-center gap-3">
              <button className="btn" disabled={index === 0} onClick={() => go(index - 1)}>
                ← Back
              </button>
              <button
                className="btn btn-primary"
                disabled={index === slides.length - 1}
                onClick={() => go(index + 1)}
              >
                Next →
              </button>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
