#!/bin/bash
set -euo pipefail

echo "[dev-entrypoint] Starting development mode with hot reload..."

# Function to start the bridge with hot reload
start_bridge() {
    echo "[dev-entrypoint] Starting bridge with hot reload..."
    cd /app/bridge && bun --watch index.ts &
    BRIDGE_PID=$!
    echo "[dev-entrypoint] Bridge started with PID: $BRIDGE_PID"
}

# Function to start the agent with watchdog
start_agent() {
    echo "[dev-entrypoint] Starting Python agent with hot reload..."
    cd /app && /home/app/venv/bin/watchmedo auto-restart \
        --patterns="*.py" \
        --recursive \
        --directory=/app/backend \
        -- /home/app/venv/bin/python backend/main.py &
    AGENT_PID=$!
    echo "[dev-entrypoint] Agent started with PID: $AGENT_PID"
}

# Cleanup function
cleanup() {
    echo "[dev-entrypoint] Cleaning up processes..."
    if [[ -n "${BRIDGE_PID:-}" ]]; then
        kill $BRIDGE_PID 2>/dev/null || true
    fi
    if [[ -n "${AGENT_PID:-}" ]]; then
        kill $AGENT_PID 2>/dev/null || true
    fi
    exit 0
}

# Set up signal handlers
trap cleanup SIGTERM SIGINT

# Start both services
start_bridge
start_agent

# Wait for either process to exit
echo "[dev-entrypoint] Both services started. Waiting for changes..."
echo "[dev-entrypoint] Press Ctrl+C to stop all services"

# Wait for any child process to exit
wait -n

# If we get here, one of the processes died, so clean up
cleanup
