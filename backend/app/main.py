from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from . import ai, auth, custom, db, sandbox
from .config import get_settings
from .scenarios import PATHS, all_scenarios, get_scenario

PASS_THRESHOLD = 80
SKILL_LIST = ["SELECT", "JOINS", "GROUP BY", "WINDOW FUNCTIONS",
              "INDEXES", "CTEs", "QUERY OPTIMIZATION"]

# The query runs in full (row_count + timing are accurate), but we only ship a
# slice to the browser so the UI never has to render tens of thousands of rows.
MAX_DISPLAY_ROWS = 1000


def _cap(result: dict) -> dict:
    """Return a copy of a run result with rows capped for client display."""
    if not result.get("ok"):
        return result
    rows = result.get("rows", [])
    total = result.get("row_count", len(rows))
    if result.get("truncated") or len(rows) > MAX_DISPLAY_ROWS:
        return {**result, "rows": rows[:MAX_DISPLAY_ROWS],
                "displayed": MAX_DISPLAY_ROWS, "truncated": True,
                "row_count": total}
    return {**result, "displayed": len(rows), "truncated": False,
            "row_count": total}


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_pool()
    await sandbox.provision_all()
    yield
    await db.close_pool()


app = FastAPI(title="SQLForge", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Any DB-connection failure (tunnel down / Studio asleep) -> a clean 503 with a
# helpful message, instead of a cryptic 500. CORS headers are still applied by
# the middleware, so the frontend can read the error.
import asyncpg  # noqa: E402
from fastapi import Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

_DB_DOWN = (
    OSError,
    ConnectionError,
    TimeoutError,
    asyncpg.exceptions.InterfaceError,
    asyncpg.exceptions.PostgresConnectionError,
)


@app.exception_handler(asyncpg.exceptions.PostgresConnectionError)
@app.exception_handler(asyncpg.exceptions.InterfaceError)
@app.exception_handler(ConnectionError)
@app.exception_handler(TimeoutError)
@app.exception_handler(OSError)
async def _db_down_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Database unavailable — the Studio DB/tunnel looks down. "
            "Run infra/lightning-studio/connect.sh, then retry."
        },
    )


# --------------------------------------------------------------------------
# Schemas
# --------------------------------------------------------------------------

class LoginIn(BaseModel):
    email: str
    display_name: str | None = None


class RunIn(BaseModel):
    scenario_key: str
    sql: str


class ExplainIn(BaseModel):
    scenario_key: str
    sql: str
    analyze: bool = True


class MentorIn(BaseModel):
    scenario_key: str
    message: str
    current_sql: str | None = None
    last_result: dict[str, Any] | None = None


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

async def _progress_row(user_id: int, key: str) -> dict:
    row = await db.pool().fetchrow(
        "SELECT * FROM app.progress WHERE user_id = $1 AND scenario_key = $2",
        user_id, key)
    if row:
        return dict(row)
    await db.pool().execute(
        "INSERT INTO app.progress (user_id, scenario_key) VALUES ($1, $2) "
        "ON CONFLICT DO NOTHING", user_id, key)
    row = await db.pool().fetchrow(
        "SELECT * FROM app.progress WHERE user_id = $1 AND scenario_key = $2",
        user_id, key)
    return dict(row)


async def _update_skills(user_id: int, skills: list[str], score: int, passed: bool):
    factor = 0.5 if passed else 0.25
    for skill in skills:
        cur = await db.pool().fetchval(
            "SELECT confidence FROM app.skills WHERE user_id = $1 AND skill = $2",
            user_id, skill) or 0
        new = max(0, min(100, round(cur + (score - cur) * factor)))
        await db.pool().execute(
            "INSERT INTO app.skills (user_id, skill, confidence) VALUES ($1,$2,$3) "
            "ON CONFLICT (user_id, skill) DO UPDATE SET confidence = $3, updated_at = now()",
            user_id, skill, new)


def _recommend_next(user_id_solved: set[str], difficulty: int) -> str | None:
    candidates = [s for s in all_scenarios()
                  if s.available and s.key not in user_id_solved]
    if not candidates:
        return None
    candidates.sort(key=lambda s: abs(s.difficulty - difficulty))
    return candidates[0].key


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------

@app.post("/api/auth/login")
async def login(body: LoginIn):
    email = body.email.strip().lower()
    if not email:
        raise HTTPException(400, "Email required")
    name = (body.display_name or email.split("@")[0]).strip()
    row = await db.pool().fetchrow(
        "INSERT INTO app.users (email, display_name) VALUES ($1, $2) "
        "ON CONFLICT (email) DO UPDATE SET display_name = app.users.display_name "
        "RETURNING id, email, display_name", email, name)
    user = dict(row)
    return {"token": auth.make_token(user["id"]), "user": user}


@app.get("/api/auth/me")
async def me(user: dict = auth.CurrentUser):
    return user


# --------------------------------------------------------------------------
# Paths & scenarios
# --------------------------------------------------------------------------

@app.get("/api/paths")
async def paths(user: dict = auth.CurrentUser):
    progress = {r["scenario_key"]: dict(r) for r in await db.pool().fetch(
        "SELECT * FROM app.progress WHERE user_id = $1", user["id"])}
    out = []
    for p in PATHS.values():
        scen = [s.public() | {"progress": progress.get(s.key)}
                for s in all_scenarios() if s.path == p["key"]]
        scen.sort(key=lambda s: s["difficulty"])
        out.append(p | {"scenarios": scen})
    return out


@app.get("/api/scenarios")
async def scenarios(user: dict = auth.CurrentUser):
    progress = {r["scenario_key"]: dict(r) for r in await db.pool().fetch(
        "SELECT * FROM app.progress WHERE user_id = $1", user["id"])}
    return [s.public() | {"progress": progress.get(s.key)} for s in all_scenarios()]


@app.get("/api/scenarios/{key}")
async def scenario_detail(key: str, user: dict = auth.CurrentUser):
    scenario = get_scenario(key)
    if not scenario:
        raise HTTPException(404, "Scenario not found")
    if scenario.available:
        await _user_scenario_schema(user["id"], key)
    prog = await _progress_row(user["id"], key)
    messages = [dict(r) for r in await db.pool().fetch(
        "SELECT role, content, created_at FROM app.mentor_messages "
        "WHERE user_id = $1 AND scenario_key = $2 ORDER BY id", user["id"], key)]
    return {"scenario": scenario.public(), "progress": prog, "mentor_messages": messages}


@app.post("/api/scenarios/{key}/reset")
async def reset_scenario(key: str, user: dict = auth.CurrentUser):
    scenario = get_scenario(key)
    if not scenario or not scenario.available:
        raise HTTPException(404, "Scenario not found")
    await _user_scenario_schema(user["id"], key, force=True)
    return {"ok": True, "message": f"Sandbox for '{scenario.title}' reset to its initial state."}


# --------------------------------------------------------------------------
# Workbench
# --------------------------------------------------------------------------

@app.post("/api/workbench/run")
async def workbench_run(body: RunIn, user: dict = auth.CurrentUser):
    scenario = get_scenario(body.scenario_key)
    if not scenario or not scenario.available:
        raise HTTPException(404, "Scenario not found")
    schema = await _user_scenario_schema(user["id"], body.scenario_key)
    result = await sandbox.run(scenario, body.sql, schema=schema)
    await db.pool().execute(
        "INSERT INTO app.query_history "
        "(user_id, scenario_key, sql, success, error, duration_ms, row_count) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7)",
        user["id"], body.scenario_key, body.sql, result["ok"],
        result["error"], result["duration_ms"], result["row_count"])
    return _cap(result)


@app.post("/api/workbench/explain")
async def workbench_explain(body: ExplainIn, user: dict = auth.CurrentUser):
    scenario = get_scenario(body.scenario_key)
    if not scenario or not scenario.available:
        raise HTTPException(404, "Scenario not found")
    schema = await _user_scenario_schema(user["id"], body.scenario_key)
    return await sandbox.explain(scenario, body.sql, analyze=body.analyze, schema=schema)


@app.post("/api/workbench/submit")
async def workbench_submit(body: RunIn, user: dict = auth.CurrentUser):
    scenario = get_scenario(body.scenario_key)
    if not scenario or not scenario.available:
        raise HTTPException(404, "Scenario not found")
    schema = await _user_scenario_schema(user["id"], body.scenario_key)

    # Apply the submission (so optimize-scenario DDL like CREATE INDEX persists),
    # then evaluate against the resulting state.
    result = await sandbox.run(scenario, body.sql, schema=schema, max_rows=None)
    if not result["ok"]:
        return {"ok": False, "error": result["error"], "score": 0, "passed": False,
                "checks": [], "feedback": {
                    "summary": "Your SQL didn't run — fix the error before evaluating.",
                    "strengths": [], "recommendations": [result["error"]]}}

    checks = await sandbox.run_checks(
        scenario, body.sql, result["columns"], result["rows"], schema=schema)
    total_weight = sum(c["weight"] for c in checks) or 1
    score = round(sum(c["weight"] for c in checks if c["passed"]) / total_weight * 100)
    passed = score >= PASS_THRESHOLD
    feedback = await ai.evaluation_feedback(scenario, body.sql, score, checks, passed)

    # persist attempt (feedback column is JSONB; codec handles serialization)
    await db.pool().execute(
        "INSERT INTO app.attempts (user_id, scenario_key, sql, score, passed, feedback) "
        "VALUES ($1,$2,$3,$4,$5,$6)",
        user["id"], body.scenario_key, body.sql, score, passed,
        {"checks": checks, "feedback": feedback})

    # update progress + adaptive difficulty
    prog = await _progress_row(user["id"], body.scenario_key)
    new_status = "solved" if passed or prog["status"] == "solved" else "in_progress"
    new_best = max(prog["best_score"], score)
    new_difficulty = min(5, prog["difficulty"] + 1) if passed else prog["difficulty"]
    await db.pool().execute(
        "UPDATE app.progress SET status=$3, best_score=$4, difficulty=$5, "
        "attempts = attempts + 1, updated_at = now() "
        "WHERE user_id=$1 AND scenario_key=$2",
        user["id"], body.scenario_key, new_status, new_best, new_difficulty)

    await _update_skills(user["id"], scenario.skills, score, passed)

    solved = {r["scenario_key"] for r in await db.pool().fetch(
        "SELECT scenario_key FROM app.progress WHERE user_id=$1 AND status='solved'",
        user["id"])}
    next_key = _recommend_next(solved, new_difficulty) if passed else None

    return {
        "ok": True, "score": score, "passed": passed, "checks": checks,
        "feedback": feedback, "result": _cap(result),
        "difficulty": new_difficulty, "next_recommendation": next_key,
    }


@app.get("/api/workbench/history")
async def workbench_history(scenario_key: str, user: dict = auth.CurrentUser):
    rows = await db.pool().fetch(
        "SELECT sql, success, error, duration_ms, row_count, created_at "
        "FROM app.query_history WHERE user_id=$1 AND scenario_key=$2 "
        "ORDER BY id DESC LIMIT 50", user["id"], scenario_key)
    return [dict(r) for r in rows]


# --------------------------------------------------------------------------
# Mentor
# --------------------------------------------------------------------------

@app.post("/api/mentor")
async def mentor(body: MentorIn, user: dict = auth.CurrentUser):
    scenario = get_scenario(body.scenario_key)
    if not scenario or not scenario.available:
        raise HTTPException(404, "Scenario not found")

    await db.pool().execute(
        "INSERT INTO app.mentor_messages (user_id, scenario_key, role, content) "
        "VALUES ($1,$2,'user',$3)", user["id"], body.scenario_key, body.message)

    history = [dict(r) for r in await db.pool().fetch(
        "SELECT role, content FROM app.mentor_messages "
        "WHERE user_id=$1 AND scenario_key=$2 ORDER BY id", user["id"], body.scenario_key)]

    reply = await ai.mentor_reply(scenario, history, body.current_sql, body.last_result)

    await db.pool().execute(
        "INSERT INTO app.mentor_messages (user_id, scenario_key, role, content) "
        "VALUES ($1,$2,'assistant',$3)", user["id"], body.scenario_key, reply)
    return {"reply": reply}


@app.get("/api/mentor/{scenario_key}")
async def mentor_thread(scenario_key: str, user: dict = auth.CurrentUser):
    rows = await db.pool().fetch(
        "SELECT role, content, created_at FROM app.mentor_messages "
        "WHERE user_id=$1 AND scenario_key=$2 ORDER BY id", user["id"], scenario_key)
    return [dict(r) for r in rows]


# --------------------------------------------------------------------------
# Progress & history
# --------------------------------------------------------------------------

@app.get("/api/progress")
async def progress(user: dict = auth.CurrentUser):
    skill_rows = {r["skill"]: r["confidence"] for r in await db.pool().fetch(
        "SELECT skill, confidence FROM app.skills WHERE user_id=$1", user["id"])}
    skills = [{"skill": s, "confidence": skill_rows.get(s, 0)} for s in SKILL_LIST]

    prog = [dict(r) for r in await db.pool().fetch(
        "SELECT scenario_key, status, best_score, difficulty, attempts, updated_at "
        "FROM app.progress WHERE user_id=$1 ORDER BY updated_at DESC", user["id"])]
    titles = {s.key: s.title for s in all_scenarios()}
    for p in prog:
        p["title"] = titles.get(p["scenario_key"], p["scenario_key"])

    solved = sum(1 for p in prog if p["status"] == "solved")
    return {
        "skills": skills,
        "scenarios": prog,
        "stats": {
            "solved": solved,
            "in_progress": sum(1 for p in prog if p["status"] == "in_progress"),
            "total_attempts": sum(p["attempts"] for p in prog),
            "available": sum(1 for s in all_scenarios() if s.available),
        },
    }


@app.get("/api/history")
async def history(user: dict = auth.CurrentUser):
    rows = await db.pool().fetch(
        "SELECT scenario_key, score, passed, feedback, created_at "
        "FROM app.attempts WHERE user_id=$1 ORDER BY id DESC LIMIT 100", user["id"])
    titles = {s.key: s.title for s in all_scenarios()}
    out = []
    for r in rows:
        d = dict(r)
        d["title"] = titles.get(d["scenario_key"], d["scenario_key"])
        out.append(d)
    return out


# --------------------------------------------------------------------------
# Custom Tracks
# --------------------------------------------------------------------------

class TrackRunIn(BaseModel):
    sql: str


class TrackSubmitIn(BaseModel):
    question_id: int
    sql: str


class DeleteConfirmIn(BaseModel):
    confirm: bool = False


async def _own_track(track_id: int, user_id: int) -> dict:
    row = await db.pool().fetchrow(
        "SELECT * FROM app.custom_tracks WHERE id=$1 AND user_id=$2",
        track_id, user_id)
    if not row:
        raise HTTPException(404, "Track not found")
    return dict(row)


async def _ensure_provisioned(track_id: int) -> None:
    schema = custom.schema_for(track_id)
    expected = await db.pool().fetchval(
        "SELECT count(*) FROM app.custom_tables WHERE track_id=$1", track_id)
    actual = await db.pool().fetchval(
        "SELECT count(*) FROM pg_tables WHERE schemaname=$1", schema)
    if int(actual or 0) < int(expected or 0):
        await custom.provision(track_id)
        await db.pool().execute(
            "UPDATE app.custom_tracks SET status='active' WHERE id=$1", track_id)


async def _user_scenario_schema(user_id: int, key: str, force: bool = False) -> str:
    scenario = get_scenario(key)
    if not scenario or not scenario.available:
        raise HTTPException(404, "Scenario not found")
    return await sandbox.provision_user_snapshot(scenario, user_id, force=force)


def _schema_text(graph: dict) -> str:
    lines = []
    for t in graph["tables"]:
        cols = ", ".join(
            f'{c["name"]} {c["type"]}' + (" PK" if c["pk"] else "")
            for c in t["columns"])
        lines.append(f"{t['name']}({cols})")
    for r in graph["relations"]:
        lines.append(
            f"-- {r['from_table']}.{r['from_col']} -> {r['to_table']}.{r['to_col']}")
    return "\n".join(lines)


@app.post("/api/tracks")
async def create_track(
    name: str = Form(...),
    level: int = Form(1),
    files: list[UploadFile] = File(...),
    user: dict = auth.CurrentUser,
):
    parsed = []
    for f in files:
        raw = await f.read()
        try:
            text = raw.decode("utf-8-sig", errors="replace")
            table = custom.parse_csv(f.filename or "table.csv", text)
        except Exception as exc:
            raise HTTPException(400, f"Could not parse {f.filename}: {exc}")
        parsed.append(table)
    if not parsed:
        raise HTTPException(400, "Upload at least one CSV file.")

    track = await db.pool().fetchrow(
        "INSERT INTO app.custom_tracks (user_id, name, level) VALUES ($1,$2,$3) "
        "RETURNING id, name, status, level, created_at",
        user["id"], name.strip() or "Untitled dataset", max(1, min(5, level)))
    track_id = track["id"]
    # dedupe table names within the track
    seen: set[str] = set()
    for t in parsed:
        base, n, tn = t["table_name"], 1, t["table_name"]
        while tn in seen:
            n += 1
            tn = f"{base}_{n}"
        seen.add(tn)
        await db.pool().execute(
            "INSERT INTO app.custom_tables (track_id, table_name, columns, row_count, csv_text) "
            "VALUES ($1,$2,$3,$4,$5)",
            track_id, tn, t["columns"], t["row_count"], t["csv_text"])
    return dict(track) | {"tables": len(parsed)}


@app.get("/api/tracks")
async def list_tracks(user: dict = auth.CurrentUser):
    rows = await db.pool().fetch(
        "SELECT t.id, t.name, t.status, t.level, t.created_at, "
        "(SELECT count(*) FROM app.custom_tables ct WHERE ct.track_id=t.id) AS tables "
        "FROM app.custom_tracks t WHERE t.user_id=$1 ORDER BY t.id DESC", user["id"])
    return [dict(r) for r in rows]


@app.get("/api/tracks/{track_id}")
async def get_track(track_id: int, user: dict = auth.CurrentUser):
    track = await _own_track(track_id, user["id"])
    graph = await custom.schema_graph(track_id)
    return {"track": track, "schema": graph}


@app.get("/api/tracks/{track_id}/schema")
async def track_schema(track_id: int, user: dict = auth.CurrentUser):
    await _own_track(track_id, user["id"])
    return await custom.schema_graph(track_id)


@app.post("/api/tracks/{track_id}/activate")
async def activate_track(track_id: int, user: dict = auth.CurrentUser):
    await _own_track(track_id, user["id"])
    await custom.provision(track_id)
    await db.pool().execute(
        "UPDATE app.custom_tracks SET status='active' WHERE id=$1", track_id)
    return {"ok": True, "schema": await custom.schema_graph(track_id)}


@app.post("/api/tracks/{track_id}/stop")
async def stop_track(track_id: int, user: dict = auth.CurrentUser):
    await _own_track(track_id, user["id"])
    await custom.teardown(track_id)
    await db.pool().execute(
        "UPDATE app.custom_tracks SET status='ready' WHERE id=$1", track_id)
    return {"ok": True}


@app.delete("/api/tracks/{track_id}")
async def delete_track(
    track_id: int, body: DeleteConfirmIn, user: dict = auth.CurrentUser
):
    await _own_track(track_id, user["id"])
    if not body.confirm:
        raise HTTPException(400, "Deletion requires explicit confirmation.")
    await custom.teardown(track_id)
    await db.pool().execute("DELETE FROM app.custom_tracks WHERE id=$1", track_id)
    return {"ok": True}


@app.post("/api/tracks/{track_id}/run")
async def track_run(track_id: int, body: TrackRunIn, user: dict = auth.CurrentUser):
    await _own_track(track_id, user["id"])
    await _ensure_provisioned(track_id)
    return _cap(await sandbox.run_in_schema(custom.schema_for(track_id), body.sql))


@app.post("/api/tracks/{track_id}/question")
async def track_question(track_id: int, user: dict = auth.CurrentUser):
    track = await _own_track(track_id, user["id"])
    await _ensure_provisioned(track_id)
    level = track["level"]
    schema = custom.schema_for(track_id)

    recent = [r["prompt"] for r in await db.pool().fetch(
        "SELECT prompt FROM app.custom_questions WHERE track_id=$1 "
        "ORDER BY id DESC LIMIT 8", track_id)]

    graph = await custom.schema_graph(track_id)
    q = None
    ai_q = await ai.custom_question_ai(_schema_text(graph), level, recent)
    if ai_q:
        check = await sandbox.run_in_schema(schema, ai_q["reference_sql"])
        if check["ok"]:
            q = {"prompt": ai_q["prompt"], "reference_sql": ai_q["reference_sql"],
                 "skills": ai_q.get("skills", ["SELECT"]), "source": "ai",
                 "level": level}
    if not q:
        q = await custom.generate_question(track_id, level, recent)
    if not q:
        raise HTTPException(422, "Could not generate a question for this dataset.")

    row = await db.pool().fetchrow(
        "INSERT INTO app.custom_questions "
        "(track_id, user_id, level, prompt, reference_sql, skills, source) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at",
        track_id, user["id"], q["level"], q["prompt"], q["reference_sql"],
        q["skills"], q["source"])
    return {"id": row["id"], "prompt": q["prompt"], "level": q["level"],
            "skills": q["skills"], "source": q["source"]}


@app.post("/api/tracks/{track_id}/submit")
async def track_submit(track_id: int, body: TrackSubmitIn, user: dict = auth.CurrentUser):
    track = await _own_track(track_id, user["id"])
    await _ensure_provisioned(track_id)
    q = await db.pool().fetchrow(
        "SELECT * FROM app.custom_questions WHERE id=$1 AND track_id=$2",
        body.question_id, track_id)
    if not q:
        raise HTTPException(404, "Question not found")

    result = await custom.evaluate(track_id, q["reference_sql"], body.sql)
    if not result["ok"]:
        return {"ok": False, "passed": False, "score": 0, "error": result["error"],
                "feedback": {"summary": "Your SQL didn't run — fix the error first.",
                             "optimization": "", "next": result["error"]}}

    feedback = await ai.custom_feedback(
        q["prompt"], body.sql, result["passed"],
        result["expected_rows"], result["got_rows"])

    await db.pool().execute(
        "INSERT INTO app.custom_attempts (question_id, user_id, sql, score, passed, feedback) "
        "VALUES ($1,$2,$3,$4,$5,$6)",
        body.question_id, user["id"], body.sql, result["score"], result["passed"],
        {"feedback": feedback, "expected_rows": result["expected_rows"],
         "got_rows": result["got_rows"]})

    await db.pool().execute(
        "UPDATE app.custom_questions SET status=$2 WHERE id=$1",
        body.question_id, "passed" if result["passed"] else "failed")

    # adaptive difficulty
    new_level = track["level"]
    if result["passed"]:
        new_level = min(5, track["level"] + 1)
    else:
        new_level = max(1, track["level"] - 1)
    await db.pool().execute(
        "UPDATE app.custom_tracks SET level=$2 WHERE id=$1", track_id, new_level)
    await _update_skills(user["id"], q["skills"], result["score"], result["passed"])

    # Curriculum progression: on a pass, advance the active question to the next
    # still-open one (easiest first); clear the pointer when the plan is done.
    if result["passed"]:
        nxt = await db.pool().fetchval(
            "SELECT id FROM app.custom_questions "
            "WHERE track_id=$1 AND status='open' AND id<>$2 "
            "ORDER BY level ASC, id ASC LIMIT 1", track_id, body.question_id)
        await db.pool().execute(
            "UPDATE app.custom_tracks SET active_question_id=$2 WHERE id=$1",
            track_id, nxt)

    return {
        "ok": True, "passed": result["passed"], "score": result["score"],
        "expected_rows": result["expected_rows"], "got_rows": result["got_rows"],
        "expected_columns": result["expected_columns"],
        "expected_preview": result["expected_preview"],
        "result": _cap(result["result"]), "feedback": feedback, "level": new_level,
    }


class TrackChatIn(BaseModel):
    message: str
    current_sql: str | None = None


@app.get("/api/tracks/{track_id}/chat")
async def track_chat_thread(track_id: int, user: dict = auth.CurrentUser):
    await _own_track(track_id, user["id"])
    rows = await db.pool().fetch(
        "SELECT role, content, created_at FROM app.custom_chat_messages "
        "WHERE track_id=$1 AND user_id=$2 ORDER BY id", track_id, user["id"])
    return [dict(r) for r in rows]


@app.post("/api/tracks/{track_id}/chat")
async def track_chat(track_id: int, body: TrackChatIn, user: dict = auth.CurrentUser):
    await _own_track(track_id, user["id"])
    msg = body.message.strip()
    if not msg:
        raise HTTPException(400, "Empty message")

    await db.pool().execute(
        "INSERT INTO app.custom_chat_messages (track_id, user_id, role, content) "
        "VALUES ($1,$2,'user',$3)", track_id, user["id"], msg)

    history = [dict(r) for r in await db.pool().fetch(
        "SELECT role, content FROM app.custom_chat_messages "
        "WHERE track_id=$1 AND user_id=$2 ORDER BY id", track_id, user["id"])]

    graph = await custom.schema_graph(track_id)
    reply = await ai.track_chat_reply(
        _schema_text(graph), history, msg, body.current_sql)

    await db.pool().execute(
        "INSERT INTO app.custom_chat_messages (track_id, user_id, role, content) "
        "VALUES ($1,$2,'assistant',$3)", track_id, user["id"], reply)
    return {"reply": reply}


@app.post("/api/tracks/{track_id}/chat/stream")
async def track_chat_stream_ep(
    track_id: int, body: TrackChatIn, user: dict = auth.CurrentUser
):
    await _own_track(track_id, user["id"])
    msg = body.message.strip()
    if not msg:
        raise HTTPException(400, "Empty message")

    await db.pool().execute(
        "INSERT INTO app.custom_chat_messages (track_id, user_id, role, content) "
        "VALUES ($1,$2,'user',$3)", track_id, user["id"], msg)
    history = [dict(r) for r in await db.pool().fetch(
        "SELECT role, content FROM app.custom_chat_messages "
        "WHERE track_id=$1 AND user_id=$2 ORDER BY id", track_id, user["id"])]
    schema_text = _schema_text(await custom.schema_graph(track_id))

    # Agentic mentor: it can run queries + set the question/curriculum. Provision
    # the sandbox first so the agent can execute/validate SQL against real data.
    await _ensure_provisioned(track_id)
    schema = custom.schema_for(track_id)
    track = await _own_track(track_id, user["id"])

    async def _run_sql(sql: str) -> dict:
        try:
            return _cap(await sandbox.run_in_schema(schema, sql))
        except Exception as exc:  # noqa: BLE001 - surface as a tool error, don't crash
            return {"ok": False, "error": str(exc)}

    async def gen():
        parts: list[str] = []
        questions: list[dict] = []
        current_index = 0
        async for kind, payload in ai.agent_chat_stream(
            schema_text, history, msg, body.current_sql, _run_sql,
            level=track["level"]):
            if kind == "delta":
                parts.append(payload)
                yield payload
            elif kind == "result":
                questions, current_index = payload
        await _apply_agent_questions(
            track_id, user["id"], questions, current_index)
        full = "".join(parts).strip()
        if full:
            await db.pool().execute(
                "INSERT INTO app.custom_chat_messages "
                "(track_id, user_id, role, content) VALUES ($1,$2,'assistant',$3)",
                track_id, user["id"], full)

    return StreamingResponse(gen(), media_type="text/plain; charset=utf-8")


async def _apply_agent_questions(
    track_id: int, user_id: int, questions: list[dict], current_index: int
) -> None:
    """Persist questions the agent created and point the track at the active one."""
    if not questions:
        return
    ids: list[int] = []
    for q in questions:
        row = await db.pool().fetchrow(
            "INSERT INTO app.custom_questions "
            "(track_id, user_id, level, prompt, reference_sql, skills, source) "
            "VALUES ($1,$2,$3,$4,$5,$6,'ai') RETURNING id",
            track_id, user_id, q["level"], q["prompt"], q["reference_sql"], q["skills"])
        ids.append(row["id"])
    active = ids[current_index] if 0 <= current_index < len(ids) else ids[0]
    await db.pool().execute(
        "UPDATE app.custom_tracks SET active_question_id=$2 WHERE id=$1",
        track_id, active)


@app.get("/api/tracks/{track_id}/question/current")
async def track_question_current(track_id: int, user: dict = auth.CurrentUser):
    """The question the workbench should show (set by the agent / curriculum)."""
    await _own_track(track_id, user["id"])
    aid = await db.pool().fetchval(
        "SELECT active_question_id FROM app.custom_tracks WHERE id=$1", track_id)
    if not aid:
        return None
    q = await db.pool().fetchrow(
        "SELECT id, prompt, level, skills, source, status "
        "FROM app.custom_questions WHERE id=$1 AND track_id=$2", aid, track_id)
    return dict(q) if q else None


@app.delete("/api/tracks/{track_id}/chat")
async def track_chat_clear(track_id: int, user: dict = auth.CurrentUser):
    await _own_track(track_id, user["id"])
    await db.pool().execute(
        "DELETE FROM app.custom_chat_messages WHERE track_id=$1 AND user_id=$2",
        track_id, user["id"])
    return {"ok": True}


@app.get("/api/health")
async def health():
    settings = get_settings()
    # round-trip the DB and report which host we're actually using (no creds)
    db_ok, db_host, db_latency_ms = False, None, None
    try:
        from urllib.parse import urlparse
        parsed = urlparse(settings.database_url)
        db_host = f"{parsed.hostname}:{parsed.port or 5432}"
        import time as _t
        t0 = _t.perf_counter()
        await db.pool().fetchval("SELECT 1")
        db_latency_ms = round((_t.perf_counter() - t0) * 1000, 1)
        db_ok = True
    except Exception as exc:  # noqa: BLE001
        db_host = db_host or "unknown"
        return {"ok": False, "ai_enabled": settings.ai_enabled,
                "db": {"ok": False, "host": db_host, "error": str(exc)}}
    return {
        "ok": True,
        "ai_enabled": settings.ai_enabled,
        "db": {"ok": db_ok, "host": db_host, "latency_ms": db_latency_ms,
               "sslmode": settings.db_sslmode},
    }
