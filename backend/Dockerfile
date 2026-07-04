# Production image for the FastAPI backend (DigitalOcean App Platform).
# Build context is the `backend/` directory (see .do/app.yaml source_dir).
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install deps first for better layer caching. pandas/asyncpg/websockets all
# ship manylinux wheels, so no compiler toolchain is needed.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code (app/, including app/global_data CSVs) — .dockerignore trims the rest.
COPY . .

# App Platform provides $PORT (defaults to 8080). Bind 0.0.0.0 so it's reachable.
EXPOSE 8080
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
