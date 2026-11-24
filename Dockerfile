FROM python:3.12-slim
WORKDIR /app
RUN mkdir /data && chown 10001:10001 /data
COPY --chown=10001:10001 server/server.py server/server.py
COPY --chown=10001:10001 shared/seeds.json shared/seeds.json
COPY --chown=10001:10001 web/ web/
USER 10001:10001
ENV HARU_HOST=0.0.0.0 HARU_PORT=8000 HARU_DB=/data/haru.sqlite3 HARU_SECURE_COOKIE=1
EXPOSE 8000
CMD ["python", "server/server.py"]
