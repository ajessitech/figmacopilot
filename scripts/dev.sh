#!/bin/bash
set -euo pipefail

# Platform configuration
PLATFORM=${PLATFORM:-"linux/amd64"}
CONTAINER_NAME=${CONTAINER_NAME:-"figma-agent-dev-container"}
PORT=${PORT:-"3055"}

# Get the absolute path to the project directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Building Docker image for development: figma-agent-dev..."
echo "Platform: $PLATFORM"
echo "Project directory: $PROJECT_DIR"

# Build the development stage of the Docker image
docker build --platform "$PLATFORM" --target development -t figma-agent-dev . 

echo "Starting development container with hot reload on localhost:$PORT ..."
echo "Container name: $CONTAINER_NAME"
echo "Source code will be mounted from: $PROJECT_DIR"
echo ""
echo "Hot reload is enabled for:"
echo "  - Python files in backend/ (using watchdog)"
echo "  - TypeScript files in bridge/ (using bun --watch)"
echo ""
echo "Press Ctrl+C to stop the development server"

# Run with volume mounts for hot reloading
docker run --rm -it \
  -p "$PORT:$PORT" \
  --name "$CONTAINER_NAME" \
  -v "$PROJECT_DIR/backend:/app/backend" \
  -v "$PROJECT_DIR/bridge:/app/bridge" \
  figma-agent-dev
