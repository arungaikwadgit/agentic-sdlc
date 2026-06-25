#!/bin/sh
# start.sh — run API and static server as sibling processes.
# If either exits, the other is killed and the container exits (non-zero),
# so Docker / Kubernetes restart policies trigger correctly.
set -e

NODE_ENV=production node dist/index.js &
API_PID=$!

serve -s public -l 3000 &
SERVE_PID=$!

# Wait for either process to exit
wait -n 2>/dev/null || wait $API_PID $SERVE_PID

# One process exited — kill the other and exit with failure
kill $API_PID $SERVE_PID 2>/dev/null || true
exit 1
