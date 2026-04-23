FROM python:3.10-bookworm

WORKDIR /app

# Use Aliyun mirrors for faster apt in China
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
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
