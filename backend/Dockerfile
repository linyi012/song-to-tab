FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

ARG INSTALL_OPTIONAL=false
RUN if [ "$INSTALL_OPTIONAL" = "true" ]; then \
      pip install torch==2.4.1 torchaudio==2.4.1 \
        --index-url https://download.pytorch.org/whl/cpu && \
      pip install demucs "basic-pitch[onnx]"; \
    fi

COPY app ./app

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=30s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
