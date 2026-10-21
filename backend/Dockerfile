FROM python:3.14-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml requirements.lock ./
COPY app ./app
RUN pip install --no-cache-dir -c requirements.lock . && useradd --uid 10001 --create-home agrocontrol && mkdir -p /var/lib/agrocontrol/files && chown -R agrocontrol:agrocontrol /var/lib/agrocontrol
COPY alembic.ini ./
COPY migrations ./migrations
USER agrocontrol
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
