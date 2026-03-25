# skillport

Convert AI coding skills, rules, and instructions between any harness. One skill in, six formats out.

Supports **Claude Code**, **Cursor**, **Codex CLI**, **OpenClaw**, **GitHub Copilot**, and **Windsurf**.

## The problem

You write a skill for Claude Code. Your team uses Cursor. Your CI runs Codex. Each tool reads a different file format with different capabilities. Rewriting skills per-tool is tedious and error-prone.

## The solution

skillport parses any harness format into an intermediate representation, then emits valid output for any target. Features that don't translate 1:1 get functional shims (wrapper scripts, instruction annotations) or explicit warnings. Nothing is silently dropped.

```
Your skill (any format) → Parse → IR → Emit → Target format(s)
```

## Quick start

### Install (Claude Code)

```bash
# Clone into your skills directory
git clone https://github.com/YOUR_USERNAME/skillport.git ~/.claude/skills/skillport
cd ~/.claude/skills/skillport && npm install
```

Then use it conversationally:
```
/skillport convert clearshot to cursor
```

### Install (Cursor)

Copy the `.cursor/skills/skillport/` directory into your project.

### Install (Codex CLI)

Copy the `.agents/skills/skillport/` directory into your project or `~/.agents/skills/`.

### Install (OpenClaw)

Copy the `skills/skillport/` directory into `~/.openclaw/skills/`.

### CLI usage

```bash
# Convert a Claude Code skill to Cursor format
npx tsx bin/skillport.ts convert ~/.claude/skills/my-skill --to cursor

# Convert to all harnesses at once
npx tsx bin/skillport.ts convert ~/.claude/skills/my-skill --to all

# Preview without writing files
npx tsx bin/skillport.ts convert ~/.claude/skills/my-skill --to codex --dry-run

# Scan a project for existing harness configs
npx tsx bin/skillport.ts detect .

# Force source format (skip auto-detection)
npx tsx bin/skillport.ts convert ./my-skill --from claude --to cursor,codex
```

## What gets converted

| Feature | Claude Code | Cursor | Codex | OpenClaw | Copilot | Windsurf |
|---|---|---|---|---|---|---|
| **Core instructions** | SKILL.md | SKILL.md / .mdc | SKILL.md | SKILL.md | .instructions.md | .windsurfrules |
| **Project rules** | CLAUDE.md | .cursor/rules/ | AGENTS.md | via skill | copilot-instructions.md | .windsurfrules |
| **Hooks** | 24 lifecycle events | partial (shell only) | none | gateway only | none | none |
| **Subagents** | context:fork | native (v2.0+) | fork command | none | none | none |
| **Tool restrictions** | per-skill enforced | global only | OS sandbox | agent-level | none | none |
| **Glob activation** | paths: field | globs: field | none | none | applyTo: field | none |
| **Dynamic context** | !`` `cmd` `` | none | none | none | none | none |

## How non-portable features are handled

skillport uses three strategies for features that don't translate directly:

1. **Native mapping** -- the target has an equivalent feature. Used directly.
2. **Shim** -- a functional approximation. Wrapper scripts, instruction text, or preamble blocks that achieve a similar effect.
3. **Annotation** -- a visible comment explaining what was lost and why. Never silent.

### Examples

| Source feature | Target | Strategy | Result |
|---|---|---|---|
| CC `allowed-tools: [Bash, Read]` | Cursor | Shim | Instruction text at top of skill body |
| CC `PreToolUse` hook | Cursor | Native | Maps to `beforeShellExecution` |
| CC `PreToolUse` hook | Codex | Shim | Wrapper script in `scripts/` |
| CC `!`` `git status` `` ` | Cursor | Shim | `scripts/render-context.sh` preprocessor |
| CC `!`` `git status` `` ` | OpenClaw | Shim | Preamble bash block (clearshot pattern) |
| CC `context: fork` | Codex | Shim | Instruction annotation for `fork` command |
| Cursor `alwaysApply: true` | CC | Native | Placed in root CLAUDE.md |
| Cursor `globs:` | Copilot | Native | Maps to `applyTo:` field |
| Cursor `globs:` | Codex | Annotation | Annotated as comment, not enforced |

## Parity report

Every conversion produces a report with three sections:

### 1. Conversion summary
What was converted, how many fields were native/shimmed/dropped.

### 2. Parity assessment
A percentage score with per-feature breakdown:
- **95-100%** Full parity -- works identically
- **80-94%** High parity -- core preserved, minor features shimmed
- **50-79%** Partial parity -- key features approximated
- **<50%** Low parity -- significant gaps, manual adaptation recommended

### 3. Key tradeoffs
Plain-English bullets explaining what changed and what to watch out for.

```
skillport: gstack (Claude Code -> Cursor)

  Source:  ~/.claude/skills/gstack
  Target:  .cursor/skills/gstack/SKILL.md

  Fields:  2 total
    ✓  1 native   (name, description, body)
    ⚡  1 shimmed  (allowed-tools)

Parity: 93% (High)

  Feature Coverage:
    ✓ Core instructions       100%  Markdown body preserved
    ⚡ Tool restrictions        80%  Instruction text, not enforced
    ✓ Activation trigger      100%  description-based discovery

  Verdict: The ported skill will work well for its core purpose.
  Tool restrictions have functional approximations.

Key Points:
• allowed-tools [Bash, Read] is now an instruction, not enforced.
  In Claude Code this was a hard constraint.
```

## Project structure

```
skillport/
├── claude-code/                  # Primary source (Claude Code skill)
│   ├── SKILL.md                  # Skill definition
│   ├── bin/skillport.ts          # CLI entry point
│   ├── src/
│   │   ├── ir.ts                 # Intermediate representation types
│   │   ├── detect.ts             # Auto-detect source format
│   │   ├── parsers/              # 6 format parsers
│   │   │   ├── claude.ts
│   │   │   ├── cursor.ts
│   │   │   ├── codex.ts
│   │   │   ├── openclaw.ts
│   │   │   ├── copilot.ts
│   │   │   └── windsurf.ts
│   │   ├── emitters/             # 6 format emitters
│   │   ├── adapters/             # Feature mapping logic
│   │   │   ├── hooks.ts          # Hook event mapping
│   │   │   ├── subagents.ts      # Subagent config mapping
│   │   │   ├── tools.ts          # Tool restriction mapping
│   │   │   ├── globs.ts          # Glob activation mapping
│   │   │   └── dynamic-context.ts
│   │   └── utils/
│   │       ├── frontmatter.ts    # YAML frontmatter parser
│   │       └── warnings.ts       # Parity report generator
│   ├── templates/                # Shim templates
│   └── package.json
├── .cursor/skills/skillport/     # Pre-ported Cursor version
├── .agents/skills/skillport/     # Pre-ported Codex version
├── skills/skillport/             # Pre-ported OpenClaw version
├── AGENTS.md                     # Universal agent instructions
├── LICENSE                       # MIT
└── README.md
```

## Contributing

PRs welcome. Main areas for contribution:

- **New harnesses** -- add a parser in `src/parsers/` and an emitter in `src/emitters/`
- **Better shims** -- improve functional approximations for non-portable features
- **Adapter refinement** -- update `src/adapters/` as harnesses ship new features
- **Tests** -- round-trip conversion tests, real skill validation

## License

MIT
