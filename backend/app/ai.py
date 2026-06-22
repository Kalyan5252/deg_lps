"""AI mentor + evaluator.

Talks to an OpenAI-compatible endpoint (Lightning.ai by default). If no API
key is configured the module degrades to a deterministic rule-based mentor so
the platform is fully usable offline.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

from .config import get_settings
from .scenarios import Scenario

logger = logging.getLogger("sqlforge.ai")

MENTOR_SYSTEM = """\
You are a senior data engineer mentoring a teammate through a live production \
incident. You are sharp, calm, and Socratic.

Hard rules:
- NEVER write the full solution query or hand over the exact index/DDL.
- Guide with pointed questions and observations, the way a senior engineer \
reviews a junior over their shoulder.
- Reference the engineer's actual SQL and query results when given.
- Push them toward EXPLAIN, the execution plan, and the data itself.
- Keep replies short: 2-5 sentences. One good question beats a paragraph.
- If they're stuck after several tries, narrow the hint, but still don't paste \
the answer.

Tone: a real engineer in an incident channel, not a chatbot. No bullet-point \
lectures unless asked.
"""


def _client_headers() -> dict[str, str]:
    s = get_settings()
    return {
        "Authorization": f"Bearer {s.lightning_api_key}",
        "Content-Type": "application/json",
    }


async def _chat(messages: list[dict[str, str]], *, max_tokens: int = 600,
                temperature: float = 0.4) -> str:
    s = get_settings()
    url = f"{s.ai_base_url.rstrip('/')}/chat/completions"
    payload = {
        "model": s.ai_model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    async with httpx.AsyncClient(timeout=s.ai_timeout_seconds) as client:
        resp = await client.post(url, headers=_client_headers(), json=payload)
        resp.raise_for_status()
        data = resp.json()
    return data["choices"][0]["message"]["content"].strip()


def _scenario_brief(scenario: Scenario) -> str:
    return (
        f"SCENARIO: {scenario.title}\n"
        f"Story: {scenario.story}\n"
        f"Tables: {', '.join(scenario.tables) or 'n/a'}\n"
        f"Objectives: {'; '.join(scenario.objectives) or 'n/a'}\n"
        f"Success criteria: {scenario.success_criteria}\n"
        f"(Hidden problems, for your eyes only — do not reveal directly: "
        f"{'; '.join(scenario.hidden_problems) or 'n/a'})"
    )


# --------------------------------------------------------------------------
# Mentor
# --------------------------------------------------------------------------

async def mentor_reply(
    scenario: Scenario,
    history: list[dict[str, str]],
    current_sql: str | None,
    last_result: dict[str, Any] | None,
) -> str:
    settings = get_settings()
    if not settings.ai_enabled:
        return _fallback_mentor(scenario, history, current_sql, last_result)

    context = _scenario_brief(scenario)
    if current_sql:
        context += f"\n\nEngineer's current editor SQL:\n```sql\n{current_sql.strip()}\n```"
    if last_result:
        if last_result.get("error"):
            context += f"\n\nTheir last query errored: {last_result['error']}"
        else:
            context += (f"\n\nTheir last query returned {last_result.get('row_count', 0)} "
                        f"rows in {last_result.get('duration_ms', 0)}ms.")

    messages = [
        {"role": "system", "content": MENTOR_SYSTEM},
        {"role": "system", "content": context},
    ]
    messages += [{"role": m["role"], "content": m["content"]} for m in history[-12:]]
    try:
        return await _chat(messages, max_tokens=400, temperature=0.5)
    except Exception as exc:
        logger.warning("AI mentor call failed, using fallback: %s", _ai_error(exc))
        return _fallback_mentor(scenario, history, current_sql, last_result)


# --------------------------------------------------------------------------
# Evaluator feedback
# --------------------------------------------------------------------------

async def evaluation_feedback(
    scenario: Scenario, user_sql: str, score: int,
    checks: list[dict[str, Any]], passed: bool,
) -> dict[str, Any]:
    settings = get_settings()
    if not settings.ai_enabled:
        return _fallback_feedback(scenario, score, checks, passed)

    checks_text = "\n".join(
        f"- [{'PASS' if c['passed'] else 'FAIL'}] {c['label']} — {c['detail']}"
        for c in checks
    )
    prompt = (
        f"{_scenario_brief(scenario)}\n\n"
        f"The engineer submitted this SQL:\n```sql\n{user_sql.strip()}\n```\n\n"
        f"Automated checks (score {score}/100, "
        f"{'PASSED' if passed else 'NOT YET PASSING'}):\n{checks_text}\n\n"
        "As their senior reviewer, respond with STRICT JSON only, no prose around it:\n"
        '{"summary": "1-2 sentence verdict in your voice",'
        ' "strengths": ["..."],'
        ' "recommendations": ["concrete next steps; if not passing, nudge — do '
        'NOT give the literal answer"]}'
    )
    try:
        raw = await _chat(
            [
                {"role": "system", "content": "You are a precise senior SQL reviewer. Output only JSON."},
                {"role": "user", "content": prompt},
            ],
            max_tokens=500, temperature=0.3,
        )
        parsed = _extract_json(raw)
        if parsed:
            parsed.setdefault("summary", "")
            parsed.setdefault("strengths", [])
            parsed.setdefault("recommendations", [])
            return parsed
    except Exception as exc:
        logger.warning("AI evaluation call failed, using fallback: %s", _ai_error(exc))
    return _fallback_feedback(scenario, score, checks, passed)


def _ai_error(exc: Exception) -> str:
    """Extract a useful message (e.g. the provider's JSON error) from a failure."""
    if isinstance(exc, httpx.HTTPStatusError):
        try:
            body = exc.response.json()
            return f"HTTP {exc.response.status_code}: {body.get('message') or body}"
        except Exception:
            return f"HTTP {exc.response.status_code}: {exc.response.text[:200]}"
    return f"{type(exc).__name__}: {exc}"


def _extract_json(text: str) -> dict[str, Any] | None:
    try:
        return json.loads(text)
    except Exception:
        pass
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            return None
    return None


# --------------------------------------------------------------------------
# Deterministic fallbacks (no API key)
# --------------------------------------------------------------------------

def _fallback_mentor(scenario, history, current_sql, last_result) -> str:
    last_user = next((m["content"] for m in reversed(history)
                      if m["role"] == "user"), "")
    text = (last_user + " " + (current_sql or "")).lower()
    if last_result and last_result.get("error"):
        return ("That error is the database telling you something specific — read it "
                "literally. Which table or column name is it complaining about, and "
                "does it exist in this schema?")
    if "explain" not in text and scenario.path == "performance":
        return ("Before changing anything, what does EXPLAIN ANALYZE say is the most "
                "expensive node in the plan? Start there.")
    if scenario.key == "duplicate_customers" and "group by" not in text:
        return ("If the same person can have several rows, what column is the *natural* "
                "identity here — and what happens if you GROUP BY it and count?")
    if scenario.path == "performance":
        return ("You've spotted the slow access pattern. What kind of index would let "
                "Postgres jump straight to those rows instead of scanning the whole "
                "table?")
    return ("What does the data itself tell you? Try a small exploratory query first, "
            "then form a hypothesis before writing the final one.")


def _fallback_feedback(scenario, score, checks, passed) -> dict[str, Any]:
    strengths = [c["label"] for c in checks if c["passed"]]
    recs = [f"{c['label']}: {c['detail']}" for c in checks if not c["passed"]]
    if passed:
        summary = f"Solid — you cleared this one at {score}/100. The incident is contained."
    else:
        summary = (f"Not passing yet ({score}/100). You're close on some checks; "
                   "keep iterating on the failing ones.")
    return {"summary": summary, "strengths": strengths or ["You're making progress."],
            "recommendations": recs or ["Tighten up and resubmit."]}
