FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY services/metrics_service/requirements.txt services/metrics_service/requirements-dev.txt ./
# Los tests viajan en la imagen (tests/) y se corren con "docker compose exec":
# hace falta lo de requirements-dev.txt (httpx para el TestClient de FastAPI).
RUN pip install --no-cache-dir -r requirements.txt -r requirements-dev.txt
RUN useradd --create-home app
COPY services/metrics_service/app ./app
COPY services/metrics_service/tests ./tests
COPY contracts ./contracts
USER app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
