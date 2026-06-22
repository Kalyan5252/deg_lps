from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import ai, auth, db, sandbox
from .config import get_settings
from .scenarios import PATHS, all_scenarios, get_scenario

PASS_THRESHOLD = 80
SKILL_LIST = ["SELECT", "JOINS", "GROUP BY", "WINDOW FUNCTIONS",
              "INDEXES", "CTEs", "QUERY OPTIMIZATION"]


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
    await sandbox.provision(scenario, force=True)
    return {"ok": True, "message": f"Sandbox for '{scenario.title}' reset to its initial state."}


# --------------------------------------------------------------------------
# Workbench
# --------------------------------------------------------------------------

@app.post("/api/workbench/run")
async def workbench_run(body: RunIn, user: dict = auth.CurrentUser):
    scenario = get_scenario(body.scenario_key)
    if not scenario or not scenario.available:
        raise HTTPException(404, "Scenario not found")
    result = await sandbox.run(scenario, body.sql)
    await db.pool().execute(
        "INSERT INTO app.query_history "
        "(user_id, scenario_key, sql, success, error, duration_ms, row_count) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7)",
        user["id"], body.scenario_key, body.sql, result["ok"],
        result["error"], result["duration_ms"], result["row_count"])
    return result


@app.post("/api/workbench/explain")
async def workbench_explain(body: ExplainIn, user: dict = auth.CurrentUser):
    scenario = get_scenario(body.scenario_key)
    if not scenario or not scenario.available:
        raise HTTPException(404, "Scenario not found")
    return await sandbox.explain(scenario, body.sql, analyze=body.analyze)


@app.post("/api/workbench/submit")
async def workbench_submit(body: RunIn, user: dict = auth.CurrentUser):
    scenario = get_scenario(body.scenario_key)
    if not scenario or not scenario.available:
        raise HTTPException(404, "Scenario not found")

    # Apply the submission (so optimize-scenario DDL like CREATE INDEX persists),
    # then evaluate against the resulting state.
    result = await sandbox.run(scenario, body.sql)
    if not result["ok"]:
        return {"ok": False, "error": result["error"], "score": 0, "passed": False,
                "checks": [], "feedback": {
                    "summary": "Your SQL didn't run — fix the error before evaluating.",
                    "strengths": [], "recommendations": [result["error"]]}}

    checks = await sandbox.run_checks(
        scenario, body.sql, result["columns"], result["rows"])
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
        "feedback": feedback, "result": result,
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


@app.get("/api/health")
async def health():
    return {"ok": True, "ai_enabled": get_settings().ai_enabled}
