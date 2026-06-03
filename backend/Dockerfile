FROM python:3.12-slim

WORKDIR /app

# PyMuPDF + Playwright Chromium 依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmupdf-dev \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2t64 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Playwright 安装 Chromium 浏览器
RUN playwright install chromium

COPY src/ ./src/

EXPOSE 3456
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "3456"]