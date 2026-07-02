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
    headers = {"Content-Type": "application/json"}
    if s.lightning_api_key.strip():  # local providers (Ollama) need no auth
        headers["Authorization"] = f"Bearer {s.lightning_api_key}"
    return headers


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


async def custom_question_ai(
    schema_text: str, level: int, recent_prompts: list[str],
) -> dict[str, Any] | None:
    """Ask the model for a question + reference SQL over a user's dataset.

    Returns {prompt, reference_sql, skills} or None (caller falls back to the
    deterministic template generator and always validates the reference SQL).
    """
    if not get_settings().ai_enabled:
        return None
    avoid = "\n".join(f"- {p}" for p in recent_prompts[-6:]) or "(none yet)"
    prompt = (
        "You are designing a hands-on SQL exercise over a learner's own dataset.\n"
        f"Difficulty level: {level}/5 (1=basic SELECT/COUNT, 3=GROUP BY, "
        "4=JOINs, 5=multi-join/window).\n\n"
        f"Database schema (PostgreSQL):\n{schema_text}\n\n"
        f"Avoid repeating these recent questions:\n{avoid}\n\n"
        "Return STRICT JSON only:\n"
        '{"prompt": "the question, in plain English, referencing real table/column '
        'names", "reference_sql": "a correct PostgreSQL query that answers it, using '
        'only the tables above", "skills": ["SELECT"|"JOINS"|"GROUP BY"|"WINDOW '
        'FUNCTIONS"|...]}'
    )
    try:
        raw = await _chat(
            [
                {"role": "system", "content": "You output only valid JSON."},
                {"role": "user", "content": prompt},
            ],
            max_tokens=500, temperature=0.6,
        )
        parsed = _extract_json(raw)
        if parsed and parsed.get("prompt") and parsed.get("reference_sql"):
            parsed.setdefault("skills", ["SELECT"])
            return parsed
    except Exception as exc:
        logger.warning("AI question generation failed: %s", _ai_error(exc))
    return None


async def custom_feedback(
    prompt: str, user_sql: str, passed: bool,
    expected_rows: int, got_rows: int,
) -> dict[str, Any]:
    if not get_settings().ai_enabled:
        return _fallback_custom_feedback(passed, expected_rows, got_rows)
    msg = (
        f"Exercise: {prompt}\n\n"
        f"Learner's SQL:\n```sql\n{user_sql.strip()}\n```\n\n"
        f"Result: {'CORRECT' if passed else 'INCORRECT'} "
        f"(reference returned {expected_rows} rows, learner returned {got_rows}).\n\n"
        "As a senior reviewer respond with STRICT JSON only:\n"
        '{"summary": "1-2 sentences", "optimization": "one concrete performance or '
        'readability tip about THEIR query", "next": "what to try next; if incorrect, '
        'a nudge — do NOT paste the answer"}'
    )
    try:
        raw = await _chat(
            [
                {"role": "system", "content": "You output only valid JSON."},
                {"role": "user", "content": msg},
            ],
            max_tokens=400, temperature=0.4,
        )
        parsed = _extract_json(raw)
        if parsed:
            parsed.setdefault("summary", "")
            parsed.setdefault("optimization", "")
            parsed.setdefault("next", "")
            return parsed
    except Exception as exc:
        logger.warning("AI custom feedback failed: %s", _ai_error(exc))
    return _fallback_custom_feedback(passed, expected_rows, got_rows)


def _fallback_custom_feedback(passed, expected_rows, got_rows) -> dict[str, Any]:
    if passed:
        return {
            "summary": "Correct — your result matches the expected output exactly.",
            "optimization": "When you're confident, check whether your filters could "
            "use an index, and prefer selecting only the columns you need.",
            "next": "Ready for a harder one — generate the next question.",
        }
    return {
        "summary": f"Not matching yet — expected {expected_rows} rows, your query "
        f"returned {got_rows}.",
        "optimization": "Re-read the question for the exact columns, grouping and "
        "ordering it asks for.",
        "next": "Compare your output shape to what's asked, adjust, and resubmit.",
    }


TUTOR_SYSTEM = """\
You are an expert SQL & data-engineering mentor having a live, back-and-forth \
conversation with a learner who is practicing on their OWN imported dataset.

Teach like a great human tutor:
- Be warm, encouraging, and conversational — this is a dialogue, not a lecture.
- Meet them where they are: answer the actual question, then offer one natural \
next step or a small check-for-understanding.
- Ground explanations in THEIR schema and columns when relevant (use the real \
table/column names you're given), with short runnable SQL examples.
- It's fine to be concise for simple questions and go deeper when they ask.

Formatting — respond in clean GitHub-flavored Markdown for high readability:
- Use `## headings` only when it genuinely helps structure a longer answer.
- Use **bold** for key terms, bullet lists for steps, and fenced ```sql code \
blocks for every query or snippet.
- Use tables when comparing options. Keep paragraphs short.

You can reference the conversation so far; stay consistent with it.
"""


async def track_chat_reply(
    schema_text: str,
    history: list[dict[str, str]],
    user_message: str,
    current_sql: str | None,
) -> str:
    """Conversational mentor reply (Markdown). Falls back when AI is disabled."""
    if not get_settings().ai_enabled:
        return _fallback_tutor(user_message, schema_text)

    context = f"The learner's dataset schema (PostgreSQL):\n{schema_text or '(no tables yet)'}"
    if current_sql and current_sql.strip():
        context += f"\n\nWhat they currently have in the editor:\n```sql\n{current_sql.strip()}\n```"

    messages = [
        {"role": "system", "content": TUTOR_SYSTEM},
        {"role": "system", "content": context},
    ]
    messages += [{"role": m["role"], "content": m["content"]} for m in history[-16:]]
    try:
        return await _chat(messages, max_tokens=900, temperature=0.5)
    except Exception as exc:
        logger.warning("AI tutor chat failed, using fallback: %s", _ai_error(exc))
        return _fallback_tutor(user_message, schema_text)


async def track_chat_stream(
    schema_text: str,
    history: list[dict[str, str]],
    user_message: str,
    current_sql: str | None,
):
    """Async generator yielding the mentor reply token-by-token (Markdown deltas)."""
    settings = get_settings()
    if not settings.ai_enabled:
        for chunk in _chunk_text(_fallback_tutor(user_message, schema_text)):
            yield chunk
        return

    context = f"The learner's dataset schema (PostgreSQL):\n{schema_text or '(no tables yet)'}"
    if current_sql and current_sql.strip():
        context += f"\n\nWhat they currently have in the editor:\n```sql\n{current_sql.strip()}\n```"
    messages = [
        {"role": "system", "content": TUTOR_SYSTEM},
        {"role": "system", "content": context},
    ]
    messages += [{"role": m["role"], "content": m["content"]} for m in history[-16:]]

    s = settings
    url = f"{s.ai_base_url.rstrip('/')}/chat/completions"
    payload = {
        "model": s.ai_model,
        "messages": messages,
        "max_tokens": 900,
        "temperature": 0.5,
        "stream": True,
    }
    got_any = False
    try:
        async with httpx.AsyncClient(timeout=s.ai_timeout_seconds) as client:
            async with client.stream(
                "POST", url, headers=_client_headers(), json=payload
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        delta = json.loads(data)["choices"][0]["delta"].get("content")
                    except Exception:
                        continue
                    if delta:
                        got_any = True
                        yield delta
    except Exception as exc:
        logger.warning("AI stream failed, using fallback: %s", _ai_error(exc))
        if not got_any:
            for chunk in _chunk_text(_fallback_tutor(user_message, schema_text)):
                yield chunk


def _chunk_text(text: str):
    """Split text into small chunks so the offline fallback also 'streams'."""
    buf = ""
    for word in text.split(" "):
        buf += word + " "
        if len(buf) >= 8:
            yield buf
            buf = ""
    if buf:
        yield buf


def _fallback_tutor(user_message: str, schema_text: str) -> str:
    tables = [ln.split("(")[0] for ln in (schema_text or "").splitlines()
              if ln and not ln.startswith("--")]
    tbl_hint = ""
    if tables:
        tbl_hint = ("\n\nYour dataset has these tables: "
                    + ", ".join(f"`{t.strip()}`" for t in tables[:8]) + ".")
    return (
        "> ⚡ **Live AI tutor is offline** (the model API has no credits right now), "
        "so I'm giving you a basic guided answer instead of a full explanation.\n\n"
        f"You asked: *{user_message.strip()[:300]}*\n\n"
        "Here's how I'd approach it:\n\n"
        "1. **Find the tables/columns involved** — open the **Schema** tab to see "
        "the structure and relationships.\n"
        "2. **Start small** — write a simple `SELECT … LIMIT 10` to see the shape of "
        "the data before building the full query.\n"
        "3. **Build up** — add `WHERE`, then `GROUP BY`/joins one step at a time, "
        "running after each change."
        f"{tbl_hint}\n\n"
        "_Add credits to the Lightning account (or point `AI_BASE_URL` at another "
        "model) and I'll give full, dataset-aware explanations with examples._"
    )


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


# ==========================================================================
# Agentic mentor — the chat mentor can ACT on the platform (run a query, set
# the active question, or lay out a whole curriculum) instead of only talking.
# ==========================================================================

AGENT_SYSTEM = """\
You are an agentic SQL mentor working INSIDE a learning platform. Besides \
talking to the learner, you can take ACTIONS on the platform.

To take an action, reply with ONLY a single fenced json block and nothing else:

```json
{"action": "run_query", "sql": "SELECT ..."}
```
Runs read-only SQL against the learner's dataset and returns rows to you. Use \
this ONLY when you genuinely need to see real data to design a good question or \
answer accurately — it costs tokens, so don't run queries speculatively.

```json
{"action": "set_question", "prompt": "the challenge in plain English",
 "reference_sql": "a correct query that answers it", "skills": ["JOINS"], "level": 2}
```
Replaces the learner's active Question panel. `reference_sql` is the hidden \
answer key and MUST run correctly on their schema (it is validated).

```json
{"action": "set_curriculum", "questions": [
  {"prompt": "...", "reference_sql": "...", "skills": ["SELECT"], "level": 1},
  {"prompt": "...", "reference_sql": "...", "skills": ["JOINS"], "level": 3}
]}
```
Lays out an ordered series of questions (easy -> hard). The first becomes active; \
the rest are served as the learner solves each.

Rules:
- When the learner asks to practice, start a plan, "go basic to advanced", or \
wants a challenge, ACT (set_question or set_curriculum) — don't just describe a \
challenge in prose, actually set it.
- Use ONLY real table/column names from the provided schema.
- NEVER reveal reference_sql or the literal answer to the learner.
- After an action succeeds, you'll be prompted to present it; then reply in \
normal friendly Markdown (no json) describing the challenge.
- For a plain question that needs no action, just reply in Markdown.
"""


def _parse_agent_action(raw: str) -> dict | None:
    m = re.search(r"```(?:json)?\s*(\{.*\})\s*```", raw, re.DOTALL)
    blob = m.group(1) if m else (raw.strip() if raw.strip().startswith("{") else None)
    if not blob:
        return None
    try:
        obj = json.loads(blob)
    except Exception:
        return None
    return obj if isinstance(obj, dict) and obj.get("action") else None


def _norm_question(a: dict, default_level: int) -> dict:
    skills = a.get("skills") or ["SELECT"]
    if isinstance(skills, str):
        skills = [skills]
    try:
        lvl = max(1, min(5, int(a.get("level") or default_level)))
    except Exception:
        lvl = default_level
    return {
        "prompt": (a.get("prompt") or "").strip(),
        "reference_sql": (a.get("reference_sql") or "").strip(),
        "skills": [str(s) for s in skills][:6] or ["SELECT"],
        "level": lvl,
    }


def _fmt_run_result(res: dict, max_rows: int = 12) -> str:
    if not res.get("ok"):
        return f"ERROR: {res.get('error')}"
    cols = res.get("columns", [])
    rows = (res.get("rows") or [])[:max_rows]
    lines = [f"columns: {', '.join(cols)}", f"row_count: {res.get('row_count')}"]
    lines += [str(r) for r in rows]
    return "\n".join(lines)


async def agent_chat(schema_text, history, user_message, current_sql, run_sql, *,
                     level: int = 1, max_steps: int = 5) -> dict:
    """Agentic mentor turn.

    `run_sql(sql) -> result dict` executes SQL in the learner's sandbox schema
    (used both for the run_query action and to validate reference_sql).

    Returns {"reply": markdown, "questions": [normalized q, ...], "current_index": int}
    where `questions` are validated questions the caller should persist, and
    current_index points at the one to make active.
    """
    settings = get_settings()
    if not settings.ai_enabled:
        return {"reply": _fallback_tutor(user_message, schema_text),
                "questions": [], "current_index": 0}

    ctx = (f"The learner's dataset schema (PostgreSQL):\n"
           f"{schema_text or '(no tables yet)'}\n"
           f"Current difficulty level: {level}/5.")
    if current_sql and current_sql.strip():
        ctx += f"\n\nEditor SQL:\n```sql\n{current_sql.strip()}\n```"

    messages = [
        {"role": "system", "content": AGENT_SYSTEM},
        {"role": "system", "content": ctx},
    ]
    messages += [{"role": m["role"], "content": m["content"]} for m in history[-16:]]

    questions: list[dict] = []
    current_index = 0
    last_text = ""

    for _ in range(max_steps):
        try:
            raw = await _chat(messages, max_tokens=1200, temperature=0.4)
        except Exception as exc:
            logger.warning("agent_chat call failed: %s", _ai_error(exc))
            return {"reply": last_text or _fallback_tutor(user_message, schema_text),
                    "questions": questions, "current_index": current_index}

        action = _parse_agent_action(raw)
        if not action:
            return {"reply": raw, "questions": questions, "current_index": current_index}

        last_text = raw
        messages.append({"role": "assistant", "content": raw})
        act = action.get("action")

        if act == "run_query":
            sql = (action.get("sql") or "").strip()
            res = await run_sql(sql) if sql else {"ok": False, "error": "empty sql"}
            messages.append({"role": "user",
                             "content": "[query result]\n" + _fmt_run_result(res)})

        elif act == "set_question":
            q = _norm_question(action, level)
            v = await run_sql(q["reference_sql"]) if q["reference_sql"] else {"ok": False, "error": "no reference_sql"}
            if v.get("ok"):
                questions.append(q)
                current_index = len(questions) - 1
                messages.append({"role": "user", "content":
                    "[question set OK] Now present this challenge to the learner in "
                    "friendly Markdown. Do NOT reveal the reference SQL. No json."})
            else:
                messages.append({"role": "user", "content":
                    f"[reference_sql failed: {v.get('error')}] Send a corrected "
                    "set_question action."})

        elif act == "set_curriculum":
            added = []
            for rawq in (action.get("questions") or [])[:8]:
                q = _norm_question(rawq, level)
                if not q["reference_sql"]:
                    continue
                v = await run_sql(q["reference_sql"])
                if v.get("ok"):
                    added.append(q)
            if added:
                added.sort(key=lambda x: x["level"])
                current_index = len(questions)
                questions.extend(added)
                messages.append({"role": "user", "content":
                    f"[curriculum of {len(added)} questions set, easy→hard] Present "
                    "the FIRST challenge to the learner in friendly Markdown. No json."})
            else:
                messages.append({"role": "user", "content":
                    "[all reference_sql failed] Re-send set_curriculum with corrected SQL."})
        else:
            return {"reply": raw, "questions": questions, "current_index": current_index}

    return {"reply": last_text or "What would you like to work on next?",
            "questions": questions, "current_index": current_index}
