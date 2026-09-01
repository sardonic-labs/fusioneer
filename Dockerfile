FROM ghcr.io/anomalyco/opencode:latest

USER root

# bun + gh CLI + git + sqlite (for queue) on Debian-based opencode image
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl unzip git ca-certificates sqlite3 \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y gh \
  && curl -fsSL https://bun.sh/install | bash \
  && mv /root/.bun/bin/bun /usr/local/bin/bun \
  && rm -rf /root/.bun \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY web/package.json web/bun.lock ./web/
RUN cd web && bun install --frozen-lockfile

COPY . .
RUN bun run build:web || (cd web && bun run build)

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD curl -fsS http://localhost:3000/health || exit 1

CMD ["bun", "run", "index.ts"]
