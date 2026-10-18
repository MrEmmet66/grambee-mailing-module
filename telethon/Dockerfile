# telethon/Dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

# Credentials are provided at runtime. The session file is generated on first
# login and stored in the container, it is not part of the image.
ENV TELETHON_SESSION_NAME=userbot
ENV TELEGRAM_API_ID=0
ENV TELEGRAM_API_HASH=""

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
