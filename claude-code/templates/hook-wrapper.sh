#!/bin/bash
# SKILLPORT: Hook Wrapper Template
# This script emulates a Claude Code hook in harnesses that don't support hooks natively.
#
# Original hook:
#   Event:   {{EVENT}}
#   Matcher: {{MATCHER}}
#   Type:    {{TYPE}}
#   Action:  {{ACTION}}
#
# Usage: Run this script manually when the equivalent event would fire.
# In Claude Code, this ran automatically. Here you must invoke it yourself.

set -euo pipefail

# The original hook action
{{ACTION}}
