FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY services/notification_service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN useradd --create-home app
COPY services/notification_service/app ./app
COPY services/notification_service/tests ./tests
COPY contracts ./contracts
USER app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
