FROM python:3.10-bookworm

WORKDIR /app

RUN apt-get update -o Acquire::AllowInsecureRepositories=true \
    && apt-get install -y --no-install-recommends --allow-unauthenticated \
       libgl1 \
    && rm -rf /var/lib/apt/lists/*

# Use Tsinghua PyPI mirror for faster pip installs
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    -i https://pypi.tuna.tsinghua.edu.cn/simple \
    --trusted-host pypi.tuna.tsinghua.edu.cn

COPY main.py .

ENV PORT=8000
EXPOSE 8000

CMD ["python", "main.py"]
