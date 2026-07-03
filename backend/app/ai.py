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


async def _chat_stream(messages: list[dict[str, str]], *, max_tokens: int = 900,
                       temperature: float = 0.4):
    """Async generator yielding content deltas from an OpenAI-compatible stream."""
    s = get_settings()
    url = f"{s.ai_base_url.rstrip('/')}/chat/completions"
    payload = {
        "model": s.ai_model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": True,
    }
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
                    yield delta


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
                    f"[curriculum of {len(added)} questions set, easy→hard] The first "
                    f"active challenge is now exactly:\n\"{added[0]['prompt']}\"\n"
                    "Present THIS exact challenge to the learner in friendly Markdown "
                    "(keep the task identical — do NOT invent a different one). "
                    "Mention there are more steps to come. No json."})
            else:
                messages.append({"role": "user", "content":
                    "[all reference_sql failed] Re-send set_curriculum with corrected SQL."})
        else:
            return {"reply": raw, "questions": questions, "current_index": current_index}

    return {"reply": last_text or "What would you like to work on next?",
            "questions": questions, "current_index": current_index}


def _split_fences(text: str) -> tuple[list[dict], str]:
    """Split buffered text into (agent actions, visible text).

    Fenced ```json blocks (and bare top-level JSON) that carry an "action" are
    extracted and HIDDEN (they hold reference SQL). Any other fenced block (e.g.
    a ```sql example) and all surrounding prose are kept as visible text.
    """
    actions: list[dict] = []
    out: list[str] = []
    last = 0
    # closed fences ```lang\n ... ```
    for m in re.finditer(r"```[ \t]*(\w*)[ \t]*\r?\n?(.*?)```", text, re.DOTALL):
        out.append(text[last:m.start()])
        body = m.group(2).strip()
        obj = None
        try:
            obj = json.loads(body)
        except Exception:
            obj = None
        if isinstance(obj, dict) and obj.get("action"):
            actions.append(obj)          # hide the action block
        else:
            out.append(m.group(0))       # keep e.g. a ```sql example
        last = m.end()
    tail = text[last:]
    # an UNCLOSED fence at the very end (model still had more to say / got cut):
    # if it looks like the start of a json action, hide it; else show it.
    open_fence = re.search(r"```[ \t]*json\b(.*)$", tail, re.DOTALL | re.IGNORECASE)
    if open_fence:
        body = open_fence.group(1).strip().rstrip("`").strip()
        obj = _try_json(body)
        if isinstance(obj, dict) and obj.get("action"):
            actions.append(obj)
            tail = tail[: open_fence.start()]
    out.append(tail)
    shown = "".join(out)
    # bare top-level JSON action (no fence)
    stripped = shown.strip()
    if not actions and stripped.startswith("{"):
        obj = _try_json(stripped)
        if isinstance(obj, dict) and obj.get("action"):
            actions.append(obj)
            shown = ""
    return actions, shown


def _try_json(s: str):
    try:
        return json.loads(s)
    except Exception:
        return None


async def _apply_agent_action(action, run_sql, questions, level, prose_emitted):
    """Execute one action. Returns (followup_message_or_None, current_index_or_None,
    is_run_query). Appends validated questions to `questions` in place."""
    act = action.get("action")
    if act == "run_query":
        sql = (action.get("sql") or "").strip()
        res = await run_sql(sql) if sql else {"ok": False, "error": "empty sql"}
        return ("[query result]\n" + _fmt_run_result(res), None, True)
    if act == "set_question":
        q = _norm_question(action, level)
        v = await run_sql(q["reference_sql"]) if q["reference_sql"] else {"ok": False, "error": "no reference_sql"}
        if v.get("ok"):
            questions.append(q)
            idx = len(questions) - 1
            follow = None if prose_emitted else (
                f"[question set OK] The active challenge is now exactly:\n\"{q['prompt']}\"\n"
                "Present THIS exact challenge to the learner in friendly Markdown "
                "(keep the task identical — do NOT invent a different one). "
                "Do NOT reveal the reference SQL. No json.")
            return (follow, idx, False)
        return (f"[reference_sql failed: {v.get('error')}] Send a corrected "
                "set_question action.", None, False)
    if act == "set_curriculum":
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
            idx = len(questions)
            questions.extend(added)
            follow = None if prose_emitted else (
                f"[curriculum of {len(added)} questions set, easy→hard] The first "
                f"active challenge is now exactly:\n\"{added[0]['prompt']}\"\n"
                "Present THIS exact challenge to the learner in friendly Markdown "
                "(keep the task identical — do NOT invent a different one). "
                "Mention there are more steps to come. No json.")
            return (follow, idx, False)
        return ("[all reference_sql failed] Re-send set_curriculum with corrected "
                "SQL.", None, False)
    return (None, None, False)


async def agent_chat_stream(schema_text, history, user_message, current_sql, run_sql,
                            *, level: int = 1, max_steps: int = 5):
    """Streaming agentic mentor turn.

    Yields tuples:
      ("delta", text)  — natural-language reply tokens to forward to the client
      ("result", (questions, current_index)) — emitted once at the end so the
        caller can persist any questions the agent created.

    Prose streams to the client live. As soon as a ``` fence begins, we stop
    emitting and buffer to end-of-turn, then extract & execute any json ACTION
    blocks (they carry reference SQL and must never be shown) while still showing
    non-action fences like ```sql examples. Actions can also be bare top-level
    JSON. run_query loops (feeding results back); a set_* action that arrived
    without accompanying prose triggers one more turn so the model presents it.
    """
    settings = get_settings()
    if not settings.ai_enabled:
        for chunk in _chunk_text(_fallback_tutor(user_message, schema_text)):
            yield ("delta", chunk)
        yield ("result", ([], 0))
        return

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

    for _ in range(max_steps):
        raw = ""
        emitted = 0          # chars of `raw` already streamed to the client
        buffering = False    # once a ``` fence (or bare-json) starts, stop emitting
        prose_emitted = False
        try:
            async for delta in _chat_stream(messages, max_tokens=1200):
                raw += delta
                if buffering:
                    continue
                # bare top-level JSON action -> hide the whole turn
                lead = raw.lstrip()
                if emitted == 0 and lead[:1] == "{":
                    buffering = True
                    continue
                fence = raw.find("```", emitted)
                if fence == -1:
                    # emit everything except a small tail that might be a partial ```
                    safe = len(raw) - 2
                    if safe > emitted:
                        yield ("delta", raw[emitted:safe])
                        prose_emitted = True
                        emitted = safe
                else:
                    if fence > emitted:
                        yield ("delta", raw[emitted:fence])
                        prose_emitted = True
                    emitted = fence
                    buffering = True
        except Exception as exc:
            logger.warning("agent stream failed: %s", _ai_error(exc))
            if not prose_emitted and not buffering:
                for chunk in _chunk_text(_fallback_tutor(user_message, schema_text)):
                    yield ("delta", chunk)
            yield ("result", (questions, current_index))
            return

        if not buffering:
            # pure prose turn — flush the held tail and finish
            if len(raw) > emitted:
                yield ("delta", raw[emitted:])
            yield ("result", (questions, current_index))
            return

        # process the buffered region (starts at the first fence / bare json)
        actions, shown = _split_fences(raw[emitted:])
        if shown.strip():
            yield ("delta", shown)
            prose_emitted = True

        if not actions:
            yield ("result", (questions, current_index))
            return

        messages.append({"role": "assistant", "content": raw})
        had_run = False
        followups: list[str] = []
        for action in actions:
            follow, idx, is_run = await _apply_agent_action(
                action, run_sql, questions, level, prose_emitted)
            if idx is not None:
                current_index = idx
            if is_run:
                had_run = True
            if follow:
                followups.append(follow)

        # continuation policy
        if had_run:
            for f in followups:
                messages.append({"role": "user", "content": f})
            continue  # loop so the model can use the query results
        if prose_emitted or not followups:
            # the model already presented (or nothing needs presenting) — done
            yield ("result", (questions, current_index))
            return
        for f in followups:
            messages.append({"role": "user", "content": f})
        # loop once more so the model presents the freshly-set question

    yield ("result", (questions, current_index))


# ==========================================================================
# RegHunt — endless adaptive challenge generator + coaching helpers
# ==========================================================================

_CREATIVITY = {
    1: "LOW — clear, textbook questions. Straightforward wording, one obvious approach.",
    2: "MEDIUM — realistic analytical questions with a light twist.",
    3: "HIGH — creative, multi-step, story-driven scenarios that combine concepts "
       "(joins + aggregation + filtering) in non-obvious ways.",
    4: "GREAT — wild, ambitious, real-world puzzle-style challenges: multi-CTE, "
       "window functions, self/cross joins, indexing reasoning, tricky edge cases. "
       "Make the learner think hard and stretch.",
}

_DIFFICULTY = {
    1: "basic SELECT / WHERE / COUNT",
    2: "filters, ORDER BY, simple GROUP BY",
    3: "GROUP BY + HAVING, single JOIN, aggregates",
    4: "multi-table JOINs (incl. self/cross), subqueries, CASE",
    5: "CTEs, window functions, ranking, complex multi-step analysis, indexing reasoning",
}


async def hunt_question(schema_text, creativity, difficulty, recent_prompts,
                        run_sql, *, streak: str = "") -> dict | None:
    """Generate ONE adaptive challenge, validated against the dataset.

    `run_sql(sql)->result` validates the reference query. Returns
    {prompt, reference_sql, skills, difficulty, multi_solution} or None.
    """
    if not get_settings().ai_enabled:
        return None
    avoid = "\n".join(f"- {p}" for p in recent_prompts[-8:]) or "(none yet)"
    prompt = (
        "You are the question-master of an endless SQL challenge hunt. Design the "
        "NEXT single challenge over the learner's dataset.\n\n"
        f"Creativity setting: {_CREATIVITY.get(creativity, _CREATIVITY[2])}\n"
        f"Target difficulty: {difficulty}/5 — {_DIFFICULTY.get(difficulty, _DIFFICULTY[3])}\n"
        f"Recent performance: {streak or 'just starting'}\n\n"
        f"Dataset schema (PostgreSQL):\n{schema_text}\n\n"
        f"Do NOT repeat these recent questions:\n{avoid}\n\n"
        "Rules: use ONLY real table/column names above; make it solvable with a "
        "single SQL query; escalate variety across joins (inner/left/self/cross), "
        "aggregations, subqueries, CTEs, window functions and indexing reasoning.\n\n"
        "Return STRICT JSON only:\n"
        '{"prompt": "the challenge in vivid plain English", '
        '"reference_sql": "a correct PostgreSQL query that answers it", '
        '"skills": ["JOINS"|"GROUP BY"|"WINDOW FUNCTIONS"|"CTE"|"SUBQUERY"|"INDEXING"|...], '
        '"multi_solution": true/false  (true if several genuinely different queries '
        'could solve it)}'
    )
    for _ in range(3):
        try:
            raw = await _chat(
                [{"role": "system", "content": "You output only valid JSON."},
                 {"role": "user", "content": prompt}],
                max_tokens=700, temperature=0.5 + 0.12 * creativity)
            data = _extract_json(raw)
        except Exception as exc:
            logger.warning("hunt_question failed: %s", _ai_error(exc))
            return None
        if not data or not data.get("reference_sql") or not data.get("prompt"):
            continue
        check = await run_sql(data["reference_sql"])
        if check.get("ok"):
            skills = data.get("skills") or ["SELECT"]
            if isinstance(skills, str):
                skills = [skills]
            return {
                "prompt": data["prompt"].strip(),
                "reference_sql": data["reference_sql"].strip(),
                "skills": [str(s) for s in skills][:6],
                "difficulty": difficulty,
                "multi_solution": bool(data.get("multi_solution")),
            }
    return None


async def hunt_hint(schema_text, prompt, user_sql) -> str:
    """A nudge — never the full answer."""
    if not get_settings().ai_enabled:
        return ("Break it down: which tables hold the columns you need, how do they "
                "join, and what do you group by? Try a small piece first.")
    ctx = (f"Dataset schema:\n{schema_text}\n\nChallenge:\n{prompt}\n\n"
           f"Learner's current SQL:\n```sql\n{user_sql or '(empty)'}\n```")
    try:
        return await _chat(
            [{"role": "system", "content":
              "You are a SQL coach. Give ONE concrete hint (2-3 sentences) that "
              "moves the learner forward. NEVER write the full solution query."},
             {"role": "user", "content": ctx}],
            max_tokens=220, temperature=0.5)
    except Exception:
        return "Think about the join keys first, then the aggregation."


async def hunt_optimize(schema_text, user_sql, run_result=None) -> str:
    """Query-optimization coaching for the learner's own SQL."""
    if not get_settings().ai_enabled:
        return ("Check for missing WHERE filters, unnecessary DISTINCT, and whether an "
                "index on your join/filter columns would help. Read the EXPLAIN plan.")
    perf = ""
    if run_result and run_result.get("ok"):
        perf = (f"\nIt returned {run_result.get('row_count')} rows in "
                f"{run_result.get('duration_ms')}ms.")
    ctx = (f"Dataset schema:\n{schema_text}\n\nThe learner's SQL:\n"
           f"```sql\n{user_sql}\n```{perf}")
    try:
        return await _chat(
            [{"role": "system", "content":
              "You are a senior SQL performance engineer. Review the query and give "
              "concrete optimization advice (indexes, join order, avoiding scans, "
              "rewrites). Be specific and reference their columns. Markdown."},
             {"role": "user", "content": ctx}],
            max_tokens=450, temperature=0.3)
    except Exception:
        return "Consider indexes on your join/filter columns and check the EXPLAIN plan."


async def hunt_reason_feedback(prompt, user_sql, reasoning) -> str:
    """React to WHY the learner chose their approach (for multi-solution questions)."""
    if not get_settings().ai_enabled:
        return "Good reasoning — weigh readability vs. performance and index usage."
    ctx = (f"Challenge:\n{prompt}\n\nTheir query:\n```sql\n{user_sql}\n```\n\n"
           f"Their stated reason for this approach:\n{reasoning}")
    try:
        return await _chat(
            [{"role": "system", "content":
              "The learner explained why they chose their approach among several "
              "valid ones. In 2-3 sentences, affirm what's sound and add one "
              "trade-off (performance/readability/index use) they should consider."},
             {"role": "user", "content": ctx}],
            max_tokens=200, temperature=0.5)
    except Exception:
        return "Solid choice — just weigh it against performance and index usage."


async def hunt_optimized_sql(schema_text, prompt, user_sql) -> str:
    """Reveal an optimized rewrite of the learner's query (returns SQL only)."""
    if not get_settings().ai_enabled or not (user_sql or "").strip():
        return user_sql or ""
    ctx = (f"Dataset schema:\n{schema_text}\n\nChallenge:\n{prompt}\n\n"
           f"The learner's working query:\n```sql\n{user_sql}\n```\n\n"
           "Rewrite it to be more efficient and idiomatic while returning the SAME "
           "result. Return ONLY the optimized SQL — no prose, no markdown fences.")
    try:
        out = await _chat(
            [{"role": "system", "content": "You output only a single SQL query."},
             {"role": "user", "content": ctx}],
            max_tokens=400, temperature=0.2)
    except Exception:
        return user_sql
    # strip any ```sql fences the model may add
    m = re.search(r"```(?:sql)?\s*(.*?)```", out, re.DOTALL | re.IGNORECASE)
    return (m.group(1) if m else out).strip()
