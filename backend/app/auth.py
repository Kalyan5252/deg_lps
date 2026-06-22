from __future__ import annotations

import datetime as dt

import jwt
from fastapi import Depends, HTTPException, Request

from . import db
from .config import get_settings


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
    row = await db.pool().fetchrow(
        "SELECT id, email, display_name FROM app.users WHERE id = $1", user_id
    )
    if not row:
        raise HTTPException(status_code=401, detail="User not found")
    return dict(row)


CurrentUser = Depends(current_user)
