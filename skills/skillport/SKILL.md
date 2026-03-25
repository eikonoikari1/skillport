---
name: skillport
description: |
  Universal skill/rule adapter across AI coding harnesses. Converts skills, rules,
  and instructions between Claude Code, Cursor, Codex CLI, OpenClaw, Copilot, and
  Windsurf. Handles harness-specific features (hooks, subagents, allowed-tools,
  globs, dynamic context) with functional equivalents or annotated fallbacks.
  Use when asked to "port", "convert", "adapt", "translate", or "make work in"
  a different harness. Also use when asked to "detect" harness configs in a project.
---

## Preamble

Run this bash block first:

```bash
# Dynamic context: !`cmd`
cmd=$(cmd 2>/dev/null || echo "[unavailable]")
echo "!`cmd`: $__cmd_"

# Dynamic context: !`cmd`
cmd=$(cmd 2>/dev/null || echo "[unavailable]")
echo "!`cmd`: $__cmd_"
```

# skillport: Universal Skill/Rule Adapter

## Step 1: Understand the Request

Parse the user's prompt to extract three things:

1. **WHAT** — Which skill/rule/config to convert
   - A path (e.g., `.claude/skills/my-skill`, `CLAUDE.md`, `.cursor/rules/`)
   - A skill name (e.g., "clearshot", "toc") — resolve to its installed path
   - "all" or "everything" — scan for all detected configs
2. **FROM** — Source harness format
   - Explicit: "from claude", "from cursor", etc.
   - Implicit: auto-detect from path and file contents
3. **TO** — Target harness format(s)
   - Explicit: "to cursor", "to codex and openclaw", "to all"
   - One or more of: `claude`, `cursor`, `codex`, `openclaw`, `copilot`, `windsurf`, `all`

### Examples of natural language parsing:

| User says | WHAT | FROM | TO |
|---|---|---|---|
| "convert clearshot to cursor" | clearshot | auto-detect | cursor |
| "port my claude skills to codex" | all claude skills | claude | codex |
| "make this cursor rule work in claude code" | (ask which rule) | cursor | claude |
| "adapt toc for all harnesses" | toc | auto-detect | all |
| "what harness configs do I have?" | (detect mode) | — | — |

### Resolution Rules:

- If WHAT is a name (not a path), search these locations:
  - `~/.claude/skills/<name>/`
  - `~/.agents/skills/<name>/`
  - `.claude/skills/<name>/` (project-local)
  - `.agents/skills/<name>/` (project-local)
  - `.cursor/skills/<name>/`
  - `.cursor/rules/<name>.mdc`

- If FROM is not stated, auto-detect by running the CLI:
  ```bash
  npx tsx ~/.claude/skills/skillport/bin/skillport.ts detect .
  ```

- **NEVER start conversion until WHAT, FROM, and TO are all resolved.**

## Step 2: Confirm Before Converting

Always show the user what you're about to do:

```
I'll convert:
  Skill:  <name> (<path>)
  From:   <harness> (auto-detected / specified)
  To:     <target harness(es)>

Proceed?
```

Wait for confirmation. If the user says "just do it" or similar, proceed.

## Step 3: Run the Conversion

Execute the CLI:

```bash
npx tsx ~/.claude/skills/skillport/bin/skillport.ts convert <source-path> --to <targets> --output <dir>
```

For dry run (preview without writing):
```bash
npx tsx ~/.claude/skills/skillport/bin/skillport.ts convert <source-path> --to <targets> --dry-run
```

For project scan:
```bash
npx tsx ~/.claude/skills/skillport/bin/skillport.ts detect <dir>
```

## Step 4: Present the Result Report

After conversion, ALWAYS present the full report to the user. The report has three mandatory sections:

### Section 1: Conversion Summary

Show what was converted and where files were written:
```
skillport: <name> (<from> → <to>)

  Source:  <source path>
  Target:  <target path>

  Fields:  N total
    ✓  X native   (fields that mapped 1:1)
    ⚡  Y shimmed  (fields with functional approximations)
    ⚠  Z dropped  (fields with no equivalent)
```

### Section 2: Parity Assessment

Show a percentage score and per-feature breakdown:
```
Parity: NN% (Full|High|Partial|Low)

  Feature Coverage:
    ✓ Core instructions       100%  Markdown body preserved
    ✓ Activation trigger      100%  description-based discovery
    ⚡ Tool restrictions        80%  Instruction text, not enforced
    ⚠ Hooks                     0%  No equivalent in target
    ...

  Verdict: <plain-English assessment>
```

Parity levels:
- **95-100%** Full — skill works identically
- **80-94%** High — core behavior preserved, minor features shimmed
- **50-79%** Partial — key features approximated, some lost
- **<50%** Low — significant gaps, manual adaptation recommended

### Section 3: Tradeoffs & Key Points

Short bullet list of the most important things to know:
```
Key Points:
• <what changed and why it matters>
• <what the user should watch out for>
• <round-trip safety notes>
```

## Supported Harnesses

| Harness | Skills | Rules | Instructions | Hooks | Subagents | Globs | Dynamic Context |
|---|---|---|---|---|---|---|---|
| Claude Code | ✓ native | ✓ native | CLAUDE.md | ✓ 24 events | ✓ context:fork | ✓ paths | ✓ !`cmd` |
| Cursor | ✓ native | ✓ .mdc | AGENTS.md | ⚡ partial | ✓ native (v2.0+) | ✓ globs | ✗ none |
| Codex CLI | ✓ native | via AGENTS.md | AGENTS.md | ✗ none | ⚡ fork cmd | ✗ none | ✗ none |
| OpenClaw | ✓ native | via skill | N/A | ⚡ gateway | ✗ none | ✗ none | ⚡ preamble |
| Copilot | ✗ none | ✓ .instructions.md | copilot-instructions.md | ✗ none | ✗ none | ✓ applyTo | ✗ none |
| Windsurf | ✗ rules only | ✓ .windsurfrules | .windsurfrules | ✗ none | ✗ none | ✗ none | ✗ none |

## Feature Adaptation Quick Reference

- **Hooks**: CC→Cursor maps PreToolUse→beforeShellExecution. Others get wrapper scripts or annotations.
- **Subagents**: CC→Cursor is near-native. Codex has fork. Others get instruction annotations.
- **allowed-tools**: Only CC enforces per-skill. Others get instruction text (agent may ignore).
- **Globs**: CC uses `paths:`, Cursor uses `globs:`, Copilot uses `applyTo:`. Others get annotations.
- **Dynamic context** (`!`cmd``): CC-only native. Others get preprocessor scripts or preamble blocks.
- **Model/effort overrides**: CC-only. Dropped with annotation for others.