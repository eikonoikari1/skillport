# skillport

Universal skill/rule adapter for AI coding harnesses.

## What this project is

skillport converts skills, rules, and instructions between Claude Code, Cursor, Codex CLI, OpenClaw, GitHub Copilot, and Windsurf. The primary source lives in `claude-code/`. Pre-ported versions for other harnesses are in their respective directories.

## Architecture

- **IR-based**: Every conversion goes through an intermediate representation (`src/ir.ts`). No N-to-N format converters.
- **Parse → IR → Emit**: Parsers in `src/parsers/` read native formats. Emitters in `src/emitters/` write them. Adapters in `src/adapters/` handle cross-harness feature mapping.
- **Three strategies for non-portable features**: native mapping, functional shims (wrapper scripts, instruction text), or annotated comments. Nothing is silently dropped.

## Key files

- `claude-code/SKILL.md` -- the skill definition (conversational-first, parses user intent for WHAT/FROM/TO)
- `claude-code/bin/skillport.ts` -- CLI entry point (commander-based, `convert` and `detect` subcommands)
- `claude-code/src/ir.ts` -- SkillIR type definitions, parity scoring
- `claude-code/src/detect.ts` -- auto-detection of harness format from file paths and frontmatter
- `claude-code/src/utils/warnings.ts` -- parity report formatting

## Conventions

- Parsers return `SkillIR`. Emitters accept `SkillIR` and return `ConversionResult` (files + warnings + parity).
- Every emitter must populate `warnings` and `features` arrays for the parity report.
- Use `buildParity()` from `utils/warnings.ts` to compute the final assessment.
- Shims go in `scripts/` within the emitted skill directory. Annotations go as HTML comments in the body.

## Adding a new harness

1. Add the harness name to `HarnessTypes` in `src/ir.ts`
2. Create `src/parsers/<harness>.ts` with a parse function returning `SkillIR`
3. Create `src/emitters/<harness>.ts` with an emit function returning `ConversionResult`
4. Add entries to the adapter mapping tables in `src/adapters/`
5. Wire the parser and emitter into `bin/skillport.ts` (the `parseSource` and `emitTarget` functions)
6. Update the detection logic in `src/detect.ts`

## Running

```bash
cd claude-code && npm install
npx tsx bin/skillport.ts convert <source> --to <target> [--dry-run]
npx tsx bin/skillport.ts detect <dir>
```
