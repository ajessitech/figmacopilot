FROM python:3.11-slim AS base
WORKDIR /app

# Install curl for downloading Bun and other essentials
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Install tini (as root)
ENV TINI_VERSION=v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini /tini
RUN chmod +x /tini

# Install Bun globally before switching to non-root user
RUN cp /root/.bun/bin/bun /usr/local/bin/bun

# Create a non-root user for security
RUN useradd --create-home --shell /bin/bash app
USER app

# ---------- Bridge dependencies ----------
COPY --chown=app:app bridge/package.json ./bridge/
RUN cd bridge && bun install

# ---------- Agent dependencies ----------
COPY --chown=app:app backend/requirements.txt ./backend/
RUN python3 -m venv /home/app/venv \
    && /home/app/venv/bin/pip install --no-cache-dir -r backend/requirements.txt

# ---------- Production Stage ----------
FROM base AS production

# Copy source code for production
COPY --chown=app:app bridge/ ./bridge/
COPY --chown=app:app backend/ ./backend/

# Expose WebSocket bridge port
EXPOSE 3055

# Use tini for signal handling
ENTRYPOINT ["/tini", "--"]

# Default command: run bridge and agent
CMD ["bash", "-c", "cd bridge && bun run start & cd /app && /home/app/venv/bin/python backend/main.py & wait -n"]

# ---------- Development Stage ----------
FROM base AS development

# Copy development entrypoint script
COPY --chown=app:app scripts/dev-entrypoint.sh /usr/local/bin/dev-entrypoint.sh
RUN chmod +x /usr/local/bin/dev-entrypoint.sh

# Expose WebSocket bridge port
EXPOSE 3055

# Use tini for signal handling
ENTRYPOINT ["/tini", "--"]

# Development command: use hot reload script
CMD ["/usr/local/bin/dev-entrypoint.sh"]
