"""Unit tests for the agent chat stream's step-event protocol (issue #23).

agent_chat_stream must interleave three kinds of events:
  ("delta", text)                     — prose forwarded to the client
  ("step", {id,label,status,detail})  — live agent-action feed (running→ok|err)
  ("result", (questions, index))     — terminal event with validated questions

We fake the model (`_chat_stream`) and AI availability so no network or DB is
needed, and drive a set_question turn followed by the forced presentation turn.
"""
from __future__ import annotations

import asyncio
import json
from unittest.mock import patch

from app import ai

# fence-only turn (no accompanying prose) — the stream must then force one
# more turn so the model presents the challenge it just set
ACTION_TURN = (
    "```json\n"
    '{"action": "set_question", "prompt": "Count the orders per customer.",\n'
    ' "reference_sql": "SELECT 1", "skills": ["JOINS"], "level": 2}\n'
    "```"
)
PRESENT_TURN = "Here's your challenge: count the orders per customer!"


def _fake_stream(turns):
    """Return an async-gen factory yielding each scripted turn in ~3 chunks."""
    it = iter(turns)

    async def stream(messages, **kw):
        text = next(it)
        step = max(1, len(text) // 3)
        for i in range(0, len(text), step):
            yield text[i:i + step]

    return stream


async def _run_sql_ok(sql: str) -> dict:
    return {"ok": True, "columns": ["c"], "rows": [{"c": 1}], "row_count": 1}


def _collect(events_gen):
    async def go():
        return [e async for e in events_gen]
    return asyncio.run(go())


def test_set_question_emits_step_events_and_result():
    with patch.object(ai, "_ai_available", return_value=True), \
         patch.object(ai, "_chat_stream", _fake_stream([ACTION_TURN, PRESENT_TURN])):
        events = _collect(ai.agent_chat_stream(
            "orders(id)", [], "give me a challenge", None, _run_sql_ok, level=2))

    kinds = [k for k, _ in events]
    assert kinds.count("result") == 1 and kinds[-1] == "result"

    steps = [p for k, p in events if k == "step"]
    assert len(steps) == 2, f"expected running+ok step pair, got {steps}"
    assert steps[0]["status"] == "running"
    assert steps[1]["status"] == "ok"
    assert steps[0]["id"] == steps[1]["id"]
    assert "reference_sql" not in json.dumps(steps)  # answer key never leaks
    assert "SELECT 1" not in json.dumps(steps)

    questions, idx = [p for k, p in events if k == "result"][0]
    assert len(questions) == 1 and idx == 0
    assert questions[0]["prompt"] == "Count the orders per customer."

    prose = "".join(p for k, p in events if k == "delta")
    assert "Here's your challenge" in prose
    assert "```json" not in prose  # action fence stays hidden


def test_run_query_step_reports_error():
    turn = (
        "```json\n"
        '{"action": "run_query", "sql": "SELECT boom"}\n'
        "```"
    )

    async def run_sql_err(sql: str) -> dict:
        return {"ok": False, "error": "column boom does not exist"}

    with patch.object(ai, "_ai_available", return_value=True), \
         patch.object(ai, "_chat_stream", _fake_stream([turn, "All done."])):
        events = _collect(ai.agent_chat_stream(
            "orders(id)", [], "check the data", None, run_sql_err))

    steps = [p for k, p in events if k == "step"]
    assert steps[0]["status"] == "running"
    assert steps[1]["status"] == "error"
    assert "boom" in (steps[1]["detail"] or "")
