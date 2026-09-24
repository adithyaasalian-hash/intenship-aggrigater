FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/models \
    FASTEMBED_CACHE_PATH=/models

WORKDIR /srv

RUN apt-get update && apt-get install -y --no-install-recommends curl tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake the model into the image. Downloading it at boot instead would add
# 30-60s to every cold start on a free tier, which is exactly the wrong place
# to spend a minute during a demo.
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('sentence-transformers/all-MiniLM-L6-v2')" \
    || echo "WARNING: model prefetch failed; service will fall back to hashing embedder"

COPY app ./app
COPY tests ./tests

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
