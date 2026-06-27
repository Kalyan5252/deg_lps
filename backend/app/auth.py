from __future__ import annotations

import datetime as dt

import asyncpg
import jwt
from fastapi import Depends, HTTPException, Request

from . import db
from .config import get_settings


def _db_error_detail(exc: Exception) -> str:
    msg = str(exc).strip()
    return msg or exc.__class__.__name__


def make_token(user_id: int) -> str:
    s = get_settings()
    payload = {
        "sub": str(user_id),
        "exp": dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=s.jwt_ttl_hours),
    }
    return jwt.encode(payload, s.jwt_secret, algorithm="HS256")


def _decode(token: str) -> int:
    s = get_settings()
    try:
        payload = jwt.decode(token, s.jwt_secret, algorithms=["HS256"])
        return int(payload["sub"])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


async def current_user(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    user_id = _decode(auth[len("Bearer "):].strip())
    row = None
    last_exc: Exception | None = None
    for attempt in range(2):
        try:
            row = await db.pool().fetchrow(
                "SELECT id, email, display_name FROM app.users WHERE id = $1", user_id
            )
            break
        except (TimeoutError, OSError, RuntimeError, asyncpg.PostgresError) as exc:
            last_exc = exc
            if attempt == 0:
                await db.pool().expire_connections()
                continue
            raise HTTPException(
                status_code=503,
                detail=(
                    "Database unavailable; check the Postgres tunnel/Studio DB. "
                    f"({_db_error_detail(exc)})"
                ),
            )
    if not row:
        if last_exc:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Database unavailable; check the Postgres tunnel/Studio DB. "
                    f"({_db_error_detail(last_exc)})"
                ),
            )
        raise HTTPException(status_code=401, detail="User not found")
    return dict(row)


CurrentUser = Depends(current_user)
