#!/bin/bash
# SKILLPORT: Dynamic Context Preprocessor
# Evaluates !`command` placeholders and injects results into SKILL.md
#
# In Claude Code, !`command` syntax is evaluated automatically before
# the skill prompt reaches the LLM. Other harnesses don't support this.
# Run this script to manually render dynamic context.

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SKILL_FILE="$SKILL_DIR/SKILL.md"

if [ ! -f "$SKILL_FILE" ]; then
  echo "Error: SKILL.md not found at $SKILL_FILE"
  exit 1
fi

echo "Rendering dynamic context in $SKILL_FILE..."

# Placeholders will be appended here by the emitter:
# {{PLACEHOLDER_COMMANDS}}

echo "Done. Dynamic context rendered successfully."
