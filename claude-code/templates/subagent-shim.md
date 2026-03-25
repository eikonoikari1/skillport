<!-- SKILLPORT: Subagent Emulation Guide

This skill was originally designed to run in a subagent (isolated context).
Your harness does not support native subagent execution.

To approximate the original behavior:

1. **Treat this as a focused task** — complete the skill's instructions
   before returning to the main conversation.

2. **Minimize context pollution** — avoid reading files or running commands
   that aren't directly needed by this skill.

3. **Report results concisely** — the original subagent returned a summary
   to the parent context. Do the same: finish the skill, then summarize
   your findings in 2-3 sentences.

Original subagent config:
  - Isolation: {{ISOLATION}}
  - Agent type: {{AGENT_TYPE}}
  - Background: {{BACKGROUND}}
-->
