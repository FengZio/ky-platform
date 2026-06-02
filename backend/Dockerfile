FROM python:3.12-slim

WORKDIR /app

# PyMuPDF 依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmupdf-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/

EXPOSE 3456
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "3456"]
