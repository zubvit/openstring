#!/bin/sh
# All tests. Plain Node, no dependencies, no framework.
set -e
for f in "$(dirname "$0")"/*.test.mjs; do
  node "$f"
done
echo "all suites passed"
