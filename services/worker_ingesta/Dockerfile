FROM python:3.12-slim

# FFmpeg y FFprobe viven dentro de la imagen: no hace falta instalarlos en el Mac.
# Los repositorios de Debian se consultan por HTTPS (por HTTP la red local devolvía 403).
RUN sed -i 's|http://|https://|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true \
    && apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /code
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY process_local.py .

# Paso 4b: el worker real (app/worker.py). Por ahora la imagen solo se usa
# para probar el pipeline con process_local.py.
CMD ["python", "-m", "app.worker"]
