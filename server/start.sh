#!/bin/bash
# Kill any process holding port 3000, then start the server.
PORT=${PORT:-3000}
echo "Checking port $PORT..."
lsof -ti tcp:$PORT | xargs kill -9 2>/dev/null && echo "Killed stale process on port $PORT" || true
sleep 0.3
node index.js
