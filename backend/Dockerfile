# Backend image: FastAPI + uvicorn.
# Single responsibility: package the API. No app logic lives here.

FROM python:3.11-slim

# libgomp1 is torch's OpenMP runtime -- sentence-transformers imports torch,
# and the slim base does not carry it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Requirements alone first: the dependency layer (which includes torch, and
# is by far the slowest) is then reused across source-only changes.
COPY requirements.txt requirements-torch.txt ./

# torch comes from PyTorch's CPU index, in its own layer and ahead of
# everything else. Resolving it from PyPI instead pulls the full NVIDIA CUDA
# stack (>1.5GB) into an image whose embedding model never leaves the CPU --
# see requirements-torch.txt. Its own layer also means a change to
# requirements.txt does not re-download the largest wheel in the build.
#
# --retries/--timeout: this is still a ~155MB download, and the default 15s
# socket timeout with a single attempt makes it the step most likely to fail
# on a slow or flaky network.
RUN pip install --no-cache-dir --retries 5 --timeout 120 -r requirements-torch.txt

RUN pip install --no-cache-dir --retries 5 --timeout 120 -r requirements.txt

COPY app ./app
COPY alembic ./alembic
COPY alembic.ini .
COPY db ./db

EXPOSE 8000

# Migrations run at start because the schema comes from alembic, not from
# db/init.sql -- that file only enables the pgvector extension. Without
# this the container starts fine and then fails on the first query against
# tables that don't exist.
#
# alembic/env.py reads DATABASE_URL from the environment (not from .env),
# which compose supplies.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
