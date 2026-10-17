# IntentGate Z backend image for IBM LinuxONE (s390x).
#
# Built on IBM's official LinuxONE Community Cloud AI/ML image, which already ships
# scikit-learn, XGBoost, TensorFlow with the IBM zDNN plugin (Telum NNPA), PyTorch and
# llama-cpp-python compiled for s390x. We add the small web layer and our code.
FROM registry.linuxone.cloud.marist.edu/l1cc/jupyterlab-image-s390x:latest

USER root
RUN /opt/venv/bin/pip install --no-cache-dir "fastapi>=0.110" "uvicorn>=0.29" "pydantic>=2.6" \
    && mkdir -p /app/backend/data && chown -R 1000:1000 /app

WORKDIR /app
COPY --chown=1000:1000 backend/intentgate /app/backend/intentgate
COPY --chown=1000:1000 ml /app/ml
COPY --chown=1000:1000 datasets /app/datasets

USER 1000
WORKDIR /app/backend
ENV PYTHONUNBUFFERED=1 \
    TF_CPP_MIN_LOG_LEVEL=2 \
    INTENTGATE_ENV=production \
    INTENTGATE_DB_PATH=/app/backend/data/intentgate.db \
    INTENTGATE_ARTIFACTS=/app/ml/artifacts \
    INTENTGATE_RESULTS=/app/ml/results \
    INTENTGATE_EVIDENCE=/app/evidence

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD /opt/venv/bin/python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/health',timeout=4)"
ENTRYPOINT ["/opt/venv/bin/python", "-m", "uvicorn", "intentgate.api:app", "--host", "127.0.0.1", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "127.0.0.1"]
