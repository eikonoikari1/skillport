#!/usr/bin/env tsx
/**
 * Comprehensive test suite for skillport.
 * Tests every parser, emitter, utility, and edge case.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Test infrastructure ──────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    const msg = detail ? `${name}: ${detail}` : name;
    failures.push(msg);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(name: string) {
  console.log(`\n━━━ ${name} ━━━`);
}

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillport-test-'));
  return dir;
}

function writeFile(dir: string, filePath: string, content: string) {
  const full = path.join(dir, filePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  return full;
}

// ─── Import modules ───────────────────────────────────────

import { parseFrontmatter, serializeFrontmatter } from '../src/utils/frontmatter.js';
import { buildParity, formatReport } from '../src/utils/warnings.js';
import { detectFormat, scanProject } from '../src/detect.js';
import { computeParityLevel, computeParityScore } from '../src/ir.js';
import type { SkillIR, FeatureParity, ConversionWarning, HookIR, DynamicContextIR } from '../src/ir.js';

import { parseClaudeSkill, parseClaudeMd } from '../src/parsers/claude.js';
import { parseCursorMdc, parseCursorrules, parseCursorSkill } from '../src/parsers/cursor.js';
import { parseCodexSkill, parseAgentsMd } from '../src/parsers/codex.js';
import { parseOpenClawSkill } from '../src/parsers/openclaw.js';
import { parseCopilotInstructions } from '../src/parsers/copilot.js';
import { parseWindsurfRules } from '../src/parsers/windsurf.js';

import { emitClaudeSkill, emitClaudeMd } from '../src/emitters/claude.js';
import { emitCursorSkill } from '../src/emitters/cursor.js';
import { emitCodexSkill, emitAgentsMd } from '../src/emitters/codex.js';
import { emitOpenClawSkill } from '../src/emitters/openclaw.js';
import { emitCopilotInstructions } from '../src/emitters/copilot.js';
import { emitWindsurfRules } from '../src/emitters/windsurf.js';

// ═══════════════════════════════════════════════════════════
// 1. FRONTMATTER TESTS
// ═══════════════════════════════════════════════════════════

section('1. Frontmatter Parser');

// 1.1 Standard frontmatter
{
  const result = parseFrontmatter(`---
name: test-skill
description: A test skill
---

# Body here

Some content.`);
  assert(result.frontmatter['name'] === 'test-skill', '1.1 Standard: name parsed');
  assert(result.frontmatter['description'] === 'A test skill', '1.1 Standard: description parsed');
  assert(result.body.startsWith('# Body here'), '1.1 Standard: body starts correctly');
}

// 1.2 No frontmatter
{
  const result = parseFrontmatter('# Just markdown\n\nNo frontmatter here.');
  assert(Object.keys(result.frontmatter).length === 0, '1.2 No frontmatter: empty object');
  assert(result.body.startsWith('# Just markdown'), '1.2 No frontmatter: body preserved');
}

// 1.3 Empty string
{
  const result = parseFrontmatter('');
  assert(Object.keys(result.frontmatter).length === 0, '1.3 Empty string: empty frontmatter');
  assert(result.body === '', '1.3 Empty string: empty body');
}

// 1.4 Frontmatter only, no body
{
  const result = parseFrontmatter(`---
name: no-body
---`);
  assert(result.frontmatter['name'] === 'no-body', '1.4 No body: name parsed');
  assert(result.body === '', '1.4 No body: empty body');
}

// 1.5 Malformed YAML (unclosed frontmatter)
{
  const result = parseFrontmatter(`---
name: broken
this is not valid`);
  assert(Object.keys(result.frontmatter).length === 0, '1.5 Malformed: falls back to empty');
  assert(result.body.includes('name: broken'), '1.5 Malformed: content preserved as body');
}

// 1.6 .mdc quirks: unquoted glob values
{
  const result = parseFrontmatter(`---
description: Test rule
alwaysApply: false
globs: src/**/*.ts, tests/**/*.test.ts
---

Rule content`);
  assert(result.frontmatter['alwaysApply'] === false, '1.6 MDC globs: boolean parsed');
  assert(Array.isArray(result.frontmatter['globs']), '1.6 MDC globs: parsed as array');
  const globs = result.frontmatter['globs'] as string[];
  assert(globs.length === 2, '1.6 MDC globs: two entries');
  assert(globs[0].includes('src/'), '1.6 MDC globs: first glob correct');
}

// 1.7 YAML with multiline description (pipe)
{
  const result = parseFrontmatter(`---
name: multi
description: |
  This is a multiline
  description value
---

Body`);
  assert(result.frontmatter['name'] === 'multi', '1.7 Multiline: name parsed');
  const desc = result.frontmatter['description'] as string;
  assert(desc.includes('multiline'), '1.7 Multiline: description contains content');
}

// 1.8 Frontmatter with allowed-tools array
{
  const result = parseFrontmatter(`---
name: restricted
allowed-tools:
  - Bash
  - Read
  - Grep
---

Content`);
  const tools = result.frontmatter['allowed-tools'] as string[];
  assert(Array.isArray(tools), '1.8 Array field: is array');
  assert(tools.length === 3, '1.8 Array field: 3 tools');
  assert(tools[0] === 'Bash', '1.8 Array field: first is Bash');
}

// 1.9 Triple dashes in body (should not confuse parser)
{
  const result = parseFrontmatter(`---
name: dashes
---

Some content

---

More content after horizontal rule`);
  assert(result.frontmatter['name'] === 'dashes', '1.9 Dashes in body: frontmatter parsed');
  assert(result.body.includes('horizontal rule'), '1.9 Dashes in body: body includes trailing content');
}

// 1.10 Serialization roundtrip
{
  const fm = { name: 'roundtrip', description: 'A test', version: '1.0.0' };
  const body = '# Test\n\nContent here.';
  const serialized = serializeFrontmatter(fm, body);
  const parsed = parseFrontmatter(serialized);
  assert(parsed.frontmatter['name'] === 'roundtrip', '1.10 Roundtrip: name survives');
  assert(parsed.frontmatter['description'] === 'A test', '1.10 Roundtrip: description survives');
  assert(parsed.body.includes('Content here'), '1.10 Roundtrip: body survives');
}

// 1.11 Serialization with empty frontmatter
{
  const serialized = serializeFrontmatter({}, 'Just body');
  assert(!serialized.includes('---'), '1.11 Empty FM serialization: no frontmatter delimiters');
  assert(serialized === 'Just body', '1.11 Empty FM serialization: body only');
}

// 1.12 MDC mode serialization
{
  const fm = { description: 'Test', alwaysApply: true, globs: ['src/**/*.ts', 'lib/**/*.js'] };
  const serialized = serializeFrontmatter(fm, 'Body', { mdcMode: true });
  assert(serialized.includes('alwaysApply: true'), '1.12 MDC serialize: boolean correct');
  assert(serialized.includes('globs:'), '1.12 MDC serialize: globs present');
}

// ═══════════════════════════════════════════════════════════
// 2. DETECT TESTS
// ═══════════════════════════════════════════════════════════

section('2. Format Detection');

// 2.1 Detect .mdc file
{
  const dir = tmpDir();
  const f = writeFile(dir, 'test.mdc', '---\ndescription: Test\n---\nContent');
  const result = detectFormat(f);
  assert(result !== null, '2.1 .mdc: detected');
  assert(result!.harness === 'cursor', '2.1 .mdc: cursor harness');
  assert(result!.confidence === 'high', '2.1 .mdc: high confidence');
  fs.rmSync(dir, { recursive: true });
}

// 2.2 Detect CLAUDE.md
{
  const dir = tmpDir();
  const f = writeFile(dir, 'CLAUDE.md', '# Rules\n\nBe helpful.');
  const result = detectFormat(f);
  assert(result !== null, '2.2 CLAUDE.md: detected');
  assert(result!.harness === 'claude', '2.2 CLAUDE.md: claude harness');
  fs.rmSync(dir, { recursive: true });
}

// 2.3 Detect AGENTS.md
{
  const dir = tmpDir();
  const f = writeFile(dir, 'AGENTS.md', '# Agent instructions');
  const result = detectFormat(f);
  assert(result !== null, '2.3 AGENTS.md: detected');
  assert(result!.harness === 'codex', '2.3 AGENTS.md: codex harness');
  fs.rmSync(dir, { recursive: true });
}

// 2.4 Detect .cursorrules
{
  const dir = tmpDir();
  const f = writeFile(dir, '.cursorrules', 'Legacy rules');
  const result = detectFormat(f);
  assert(result !== null, '2.4 .cursorrules: detected');
  assert(result!.harness === 'cursor', '2.4 .cursorrules: cursor harness');
  fs.rmSync(dir, { recursive: true });
}

// 2.5 Detect .windsurfrules
{
  const dir = tmpDir();
  const f = writeFile(dir, '.windsurfrules', 'Windsurf rules');
  const result = detectFormat(f);
  assert(result !== null, '2.5 .windsurfrules: detected');
  assert(result!.harness === 'windsurf', '2.5 .windsurfrules: windsurf harness');
  fs.rmSync(dir, { recursive: true });
}

// 2.6 Detect by path: .claude/skills/
{
  const dir = tmpDir();
  writeFile(dir, '.claude/skills/test/SKILL.md', '---\nname: test\nallowed-tools:\n  - Bash\n---\nContent');
  const result = detectFormat(path.join(dir, '.claude', 'skills', 'test'));
  assert(result !== null, '2.6 .claude/skills/ path: detected');
  assert(result!.harness === 'claude', '2.6 .claude/skills/ path: claude harness');
  fs.rmSync(dir, { recursive: true });
}

// 2.7 Detect by path: .agents/skills/ with openai.yaml
{
  const dir = tmpDir();
  writeFile(dir, '.agents/skills/test/SKILL.md', '---\nname: test\n---\nContent');
  writeFile(dir, '.agents/skills/test/openai.yaml', 'interface:\n  display_name: Test');
  const result = detectFormat(path.join(dir, '.agents', 'skills', 'test'));
  assert(result !== null, '2.7 .agents/skills/ + openai.yaml: detected');
  assert(result!.harness === 'codex', '2.7 .agents/skills/ + openai.yaml: codex harness');
  assert(result!.confidence === 'high', '2.7 .agents/skills/ + openai.yaml: high confidence');
  fs.rmSync(dir, { recursive: true });
}

// 2.8 Detect SKILL.md with Claude-specific frontmatter
{
  const dir = tmpDir();
  writeFile(dir, 'my-skill/SKILL.md', '---\nname: test\nallowed-tools:\n  - Bash\ncontext: fork\n---\nContent');
  const result = detectFormat(path.join(dir, 'my-skill'));
  assert(result !== null, '2.8 SKILL.md with CC fields: detected');
  assert(result!.harness === 'claude', '2.8 SKILL.md with CC fields: claude');
  fs.rmSync(dir, { recursive: true });
}

// 2.9 Detect nonexistent path
{
  const result = detectFormat('/nonexistent/path/that/does/not/exist');
  assert(result === null, '2.9 Nonexistent path: returns null');
}

// 2.10 Detect generic SKILL.md (no harness clues)
{
  const dir = tmpDir();
  writeFile(dir, 'generic/SKILL.md', '---\nname: generic\ndescription: A generic skill\n---\nContent');
  const result = detectFormat(path.join(dir, 'generic'));
  assert(result !== null, '2.10 Generic SKILL.md: detected');
  assert(result!.harness === 'claude', '2.10 Generic SKILL.md: defaults to claude');
  assert(result!.confidence === 'low', '2.10 Generic SKILL.md: low confidence');
  fs.rmSync(dir, { recursive: true });
}

// 2.11 scanProject
{
  const dir = tmpDir();
  writeFile(dir, 'CLAUDE.md', '# Rules');
  writeFile(dir, 'AGENTS.md', '# Agent rules');
  writeFile(dir, '.cursor/rules/test.mdc', '---\ndescription: Test\n---\nContent');
  writeFile(dir, '.github/copilot-instructions.md', '# Copilot');
  const results = scanProject(dir);
  assert(results.length >= 3, '2.11 scanProject: found multiple configs');
  const harnesses = results.map(r => r.harness);
  assert(harnesses.includes('claude'), '2.11 scanProject: found claude');
  assert(harnesses.includes('codex'), '2.11 scanProject: found codex');
  assert(harnesses.includes('cursor'), '2.11 scanProject: found cursor');
  fs.rmSync(dir, { recursive: true });
}

// 2.12 scanProject on empty directory
{
  const dir = tmpDir();
  const results = scanProject(dir);
  assert(results.length === 0, '2.12 Empty project scan: no results');
  fs.rmSync(dir, { recursive: true });
}

// ═══════════════════════════════════════════════════════════
// 3. PARITY / WARNINGS TESTS
// ═══════════════════════════════════════════════════════════

section('3. Parity & Warnings');

// 3.1 computeParityScore
{
  assert(computeParityScore([]) === 100, '3.1 Empty features: 100%');
  const features: FeatureParity[] = [
    { feature: 'A', status: 'native', percent: 100, notes: '' },
    { feature: 'B', status: 'shimmed', percent: 50, notes: '' },
  ];
  assert(computeParityScore(features) === 75, '3.1 Mixed features: 75%');
}

// 3.2 computeParityLevel
{
  assert(computeParityLevel(100) === 'full', '3.2 Level 100: full');
  assert(computeParityLevel(95) === 'full', '3.2 Level 95: full');
  assert(computeParityLevel(94) === 'high', '3.2 Level 94: high');
  assert(computeParityLevel(80) === 'high', '3.2 Level 80: high');
  assert(computeParityLevel(79) === 'partial', '3.2 Level 79: partial');
  assert(computeParityLevel(50) === 'partial', '3.2 Level 50: partial');
  assert(computeParityLevel(49) === 'low', '3.2 Level 49: low');
  assert(computeParityLevel(0) === 'low', '3.2 Level 0: low');
}

// 3.3 buildParity
{
  const features: FeatureParity[] = [
    { feature: 'Core', status: 'native', percent: 100, notes: 'ok' },
    { feature: 'Hooks', status: 'dropped', percent: 0, notes: 'gone' },
  ];
  const parity = buildParity(features, { name: 'test' } as any);
  assert(parity.score === 50, '3.3 buildParity: score is 50');
  assert(parity.level === 'partial', '3.3 buildParity: level is partial');
  assert(parity.verdict.includes('test'), '3.3 buildParity: verdict mentions skill name');
}

// 3.4 formatReport
{
  const warnings: ConversionWarning[] = [
    { field: 'body', level: 'native', message: 'Preserved' },
    { field: 'hooks', level: 'dropped', message: 'No equivalent' },
  ];
  const features: FeatureParity[] = [
    { feature: 'Core', status: 'native', percent: 100, notes: 'ok' },
  ];
  const parity = buildParity(features, { name: 'test' } as any);
  const report = formatReport('test', 'claude', 'cursor', '/src', '/dst', warnings, parity);
  assert(report.includes('test'), '3.4 Report: contains skill name');
  assert(report.includes('claude'), '3.4 Report: contains source');
  assert(report.includes('cursor'), '3.4 Report: contains target');
  assert(report.includes('Key Points'), '3.4 Report: has key points section');
  assert(report.includes('No equivalent'), '3.4 Report: includes dropped warning');
}

// ═══════════════════════════════════════════════════════════
// 4. PARSER TESTS
// ═══════════════════════════════════════════════════════════

section('4. Parsers');

// 4.1 Claude skill parser — full featured
{
  const dir = tmpDir();
  writeFile(dir, 'my-skill/SKILL.md', `---
name: full-skill
description: A fully featured skill
version: 2.0.0
allowed-tools:
  - Bash
  - Read
context: fork
agent: Explore
model: opus
effort: high
disable-model-invocation: true
---

# Full Skill

Run this: !${'`'}git status${'`'}

Then do stuff.`);
  writeFile(dir, 'my-skill/scripts/check.sh', '#!/bin/bash\necho ok');
  writeFile(dir, 'my-skill/references/guide.md', '# Guide\n\nSome reference.');

  const ir = parseClaudeSkill(path.join(dir, 'my-skill'));
  assert(ir.name === 'full-skill', '4.1 CC parser: name');
  assert(ir.description === 'A fully featured skill', '4.1 CC parser: description');
  assert(ir.version === '2.0.0', '4.1 CC parser: version');
  assert(ir.allowedTools?.length === 2, '4.1 CC parser: allowed-tools count');
  assert(ir.allowedTools?.[0] === 'Bash', '4.1 CC parser: first tool');
  assert(ir.subagent?.enabled === true, '4.1 CC parser: subagent enabled');
  assert(ir.subagent?.agentType === 'Explore', '4.1 CC parser: agent type');
  assert(ir.subagent?.isolation === 'fork', '4.1 CC parser: isolation');
  assert(ir.model === 'opus', '4.1 CC parser: model');
  assert(ir.effort === 'high', '4.1 CC parser: effort');
  assert(ir.activation.mode === 'explicit', '4.1 CC parser: activation mode (disable-model-invocation=true + user-invocable=default true)');
  assert(ir.dynamicContext?.length === 1, '4.1 CC parser: dynamic context found');
  assert(ir.dynamicContext?.[0].command === 'git status', '4.1 CC parser: dynamic context command');
  assert(ir.scripts?.length! >= 1, '4.1 CC parser: scripts found');
  assert(ir.references?.length === 1, '4.1 CC parser: references found');
  assert(ir.sourceFormat === 'claude', '4.1 CC parser: source format');
  assert(ir.harnessSpecific?.claude?.disableModelInvocation === true, '4.1 CC parser: harness-specific preserved');
  fs.rmSync(dir, { recursive: true });
}

// 4.2 Claude skill parser — minimal
{
  const dir = tmpDir();
  writeFile(dir, 'minimal/SKILL.md', '---\nname: minimal\n---\nJust content.');
  const ir = parseClaudeSkill(path.join(dir, 'minimal'));
  assert(ir.name === 'minimal', '4.2 CC minimal: name');
  assert(ir.description === '', '4.2 CC minimal: empty description');
  assert(ir.body === 'Just content.', '4.2 CC minimal: body');
  assert(ir.allowedTools === undefined, '4.2 CC minimal: no allowed-tools');
  assert(ir.hooks === undefined, '4.2 CC minimal: no hooks');
  assert(ir.subagent === undefined, '4.2 CC minimal: no subagent');
  fs.rmSync(dir, { recursive: true });
}

// 4.3 Claude skill parser — no frontmatter at all
{
  const dir = tmpDir();
  writeFile(dir, 'bare/SKILL.md', '# Just markdown\n\nNo frontmatter.');
  const ir = parseClaudeSkill(path.join(dir, 'bare'));
  assert(ir.name === 'bare', '4.3 CC bare: name from directory');
  assert(ir.body.includes('Just markdown'), '4.3 CC bare: body preserved');
  fs.rmSync(dir, { recursive: true });
}

// 4.4 CLAUDE.md parser
{
  const dir = tmpDir();
  const f = writeFile(dir, 'CLAUDE.md', '# Project Rules\n\nBe concise.\nWrite tests.');
  const ir = parseClaudeMd(f);
  assert(ir.name === 'project-instructions', '4.4 CLAUDE.md: default name');
  assert(ir.activation.mode === 'always', '4.4 CLAUDE.md: always mode');
  assert(ir.body.includes('Be concise'), '4.4 CLAUDE.md: body preserved');
  assert(ir.sourceFormat === 'claude', '4.4 CLAUDE.md: source format');
  fs.rmSync(dir, { recursive: true });
}

// 4.5 CLAUDE.md with paths frontmatter
{
  const dir = tmpDir();
  const f = writeFile(dir, 'CLAUDE.md', '---\npaths:\n  - src/**/*.ts\n---\n# Scoped rules');
  const ir = parseClaudeMd(f);
  assert(ir.activation.mode === 'glob', '4.5 CLAUDE.md with paths: glob mode');
  assert(ir.activation.globs?.length === 1, '4.5 CLAUDE.md with paths: one glob');
  fs.rmSync(dir, { recursive: true });
}

// 4.6 Cursor .mdc parser — full
{
  const dir = tmpDir();
  const f = writeFile(dir, 'testing.mdc', `---
description: Testing conventions for the project
alwaysApply: false
globs: "**/*.test.ts", "**/*.spec.ts"
---

# Testing Rules

Always use vitest.`);
  const ir = parseCursorMdc(f);
  assert(ir.name === 'testing', '4.6 Cursor .mdc: name from filename');
  assert(ir.description === 'Testing conventions for the project', '4.6 Cursor .mdc: description');
  assert(ir.activation.mode === 'glob', '4.6 Cursor .mdc: glob mode');
  assert(ir.activation.globs?.length === 2, '4.6 Cursor .mdc: two globs');
  assert(ir.harnessSpecific?.cursor?.alwaysApply === undefined, '4.6 Cursor .mdc: alwaysApply false not stored');
  fs.rmSync(dir, { recursive: true });
}

// 4.7 Cursor .mdc — alwaysApply
{
  const dir = tmpDir();
  const f = writeFile(dir, 'base.mdc', `---
description: Base rules
alwaysApply: true
---

# Base rules`);
  const ir = parseCursorMdc(f);
  assert(ir.activation.mode === 'always', '4.7 Cursor alwaysApply: always mode');
  assert(ir.harnessSpecific?.cursor?.alwaysApply === true, '4.7 Cursor alwaysApply: stored');
  fs.rmSync(dir, { recursive: true });
}

// 4.8 Cursor .mdc — manual (no description, no globs, not alwaysApply)
{
  const dir = tmpDir();
  const f = writeFile(dir, 'manual.mdc', `---
alwaysApply: false
---

# Manual rule`);
  const ir = parseCursorMdc(f);
  assert(ir.activation.mode === 'manual', '4.8 Cursor manual: manual mode');
  fs.rmSync(dir, { recursive: true });
}

// 4.9 .cursorrules legacy
{
  const dir = tmpDir();
  const f = writeFile(dir, '.cursorrules', 'Be helpful.\nWrite clean code.');
  const ir = parseCursorrules(f);
  assert(ir.name === 'cursorrules', '4.9 .cursorrules: name');
  assert(ir.activation.mode === 'always', '4.9 .cursorrules: always mode');
  assert(ir.body.includes('clean code'), '4.9 .cursorrules: body preserved');
  fs.rmSync(dir, { recursive: true });
}

// 4.10 Cursor skill parser
{
  const dir = tmpDir();
  writeFile(dir, 'cs-skill/SKILL.md', '---\nname: cs-test\ndescription: Cursor skill\n---\nContent');
  writeFile(dir, 'cs-skill/scripts/run.sh', '#!/bin/bash\necho hi');
  const ir = parseCursorSkill(path.join(dir, 'cs-skill'));
  assert(ir.name === 'cs-test', '4.10 Cursor skill: name');
  assert(ir.scripts?.length === 1, '4.10 Cursor skill: scripts found');
  assert(ir.sourceFormat === 'cursor', '4.10 Cursor skill: source format');
  fs.rmSync(dir, { recursive: true });
}

// 4.11 Codex skill parser
{
  const dir = tmpDir();
  writeFile(dir, 'cx-skill/SKILL.md', '---\nname: cx-test\ndescription: Codex skill\n---\nContent');
  const ir = parseCodexSkill(path.join(dir, 'cx-skill'));
  assert(ir.name === 'cx-test', '4.11 Codex skill: name');
  assert(ir.sourceFormat === 'codex', '4.11 Codex skill: source format');
  assert(ir.activation.triggerKeyword === '$cx-test', '4.11 Codex skill: trigger keyword');
  fs.rmSync(dir, { recursive: true });
}

// 4.12 AGENTS.md parser
{
  const dir = tmpDir();
  const f = writeFile(dir, 'AGENTS.md', '# Instructions\n\nDo good work.');
  const ir = parseAgentsMd(f);
  assert(ir.name === 'agents-instructions', '4.12 AGENTS.md: name');
  assert(ir.activation.mode === 'always', '4.12 AGENTS.md: always mode');
  assert(ir.body.includes('good work'), '4.12 AGENTS.md: body preserved');
  fs.rmSync(dir, { recursive: true });
}

// 4.13 OpenClaw skill parser
{
  const dir = tmpDir();
  writeFile(dir, 'oc-skill/SKILL.md', '---\nname: oc-test\ndescription: OpenClaw skill\n---\nContent');
  const ir = parseOpenClawSkill(path.join(dir, 'oc-skill'));
  assert(ir.name === 'oc-test', '4.13 OpenClaw skill: name');
  assert(ir.sourceFormat === 'openclaw', '4.13 OpenClaw skill: source format');
  fs.rmSync(dir, { recursive: true });
}

// 4.14 Copilot instructions parser — root
{
  const dir = tmpDir();
  const f = writeFile(dir, 'copilot-instructions.md', '# Copilot rules\n\nBe helpful.');
  const ir = parseCopilotInstructions(f);
  assert(ir.name === 'copilot-instructions', '4.14 Copilot root: name');
  assert(ir.activation.mode === 'always', '4.14 Copilot root: always mode');
  fs.rmSync(dir, { recursive: true });
}

// 4.15 Copilot instructions parser — scoped
{
  const dir = tmpDir();
  const f = writeFile(dir, 'testing.instructions.md', `---
description: Testing rules
applyTo: "**/*.test.ts"
---

Use vitest.`);
  const ir = parseCopilotInstructions(f);
  assert(ir.name === 'testing', '4.15 Copilot scoped: name');
  assert(ir.activation.mode === 'glob', '4.15 Copilot scoped: glob mode');
  assert(ir.activation.globs?.length === 1, '4.15 Copilot scoped: one glob');
  fs.rmSync(dir, { recursive: true });
}

// 4.16 Windsurf rules parser
{
  const dir = tmpDir();
  const f = writeFile(dir, '.windsurfrules', 'Be concise.\nNo fluff.');
  const ir = parseWindsurfRules(f);
  assert(ir.name === 'windsurf-rules', '4.16 Windsurf: name');
  assert(ir.activation.mode === 'always', '4.16 Windsurf: always mode');
  assert(ir.body.includes('No fluff'), '4.16 Windsurf: body preserved');
  fs.rmSync(dir, { recursive: true });
}

// 4.17 Parser with real installed skill (toc)
{
  const tocPath = path.join(os.homedir(), '.claude', 'skills', 'toc');
  if (fs.existsSync(tocPath)) {
    const ir = parseClaudeSkill(tocPath);
    assert(ir.name === 'toc', '4.17 Real toc skill: name');
    assert(ir.description.length > 0, '4.17 Real toc skill: has description');
    assert(ir.body.length > 0, '4.17 Real toc skill: has body');
    assert(ir.sourceFormat === 'claude', '4.17 Real toc skill: source format');
  } else {
    console.log('  ~ 4.17 Skipped: toc skill not installed');
  }
}

// ═══════════════════════════════════════════════════════════
// 5. EMITTER TESTS
// ═══════════════════════════════════════════════════════════

section('5. Emitters');

// Build a maximally complex IR for testing all emitters
function buildComplexIR(): SkillIR {
  return {
    name: 'complex-skill',
    description: 'A skill with every feature enabled',
    version: '3.0.0',
    body: '# Complex Skill\n\nDo complex things.\n\nRun: !`git log --oneline -5`',
    activation: {
      mode: 'glob',
      globs: ['src/**/*.ts', 'lib/**/*.js'],
      triggerKeyword: '/complex-skill',
    },
    allowedTools: ['Bash', 'Read', 'Grep'],
    deniedTools: undefined,
    hooks: [
      {
        event: 'PreToolUse',
        matcher: 'Bash',
        handler: { type: 'command', value: './scripts/pre-check.sh', timeout: 5000 },
        canBlock: true,
      },
      {
        event: 'PostToolUse',
        matcher: undefined,
        handler: { type: 'prompt', value: 'Verify the output is safe' },
        canBlock: false,
      },
    ],
    subagent: {
      enabled: true,
      agentType: 'Explore',
      isolation: 'fork',
    },
    dynamicContext: [
      { placeholder: '!`git log --oneline -5`', command: 'git log --oneline -5' },
    ],
    model: 'opus',
    effort: 'high',
    scripts: [{ path: 'pre-check.sh', content: '#!/bin/bash\necho checking' }],
    references: [{ path: 'guide.md', content: '# Guide' }],
    harnessSpecific: {
      claude: { disableModelInvocation: true },
      codex: { displayName: 'Complex Skill', brandColor: '#FF0000' },
    },
    sourceFormat: 'claude',
    sourceFiles: ['/test/SKILL.md'],
  };
}

// 5.1 Emit to Claude Code
{
  const ir = buildComplexIR();
  const out = tmpDir();
  const result = emitClaudeSkill(ir, out);

  assert(result.files.length >= 3, '5.1 CC emit: multiple files generated');
  const skillMd = result.files.find(f => f.path.endsWith('SKILL.md'));
  assert(skillMd !== undefined, '5.1 CC emit: SKILL.md generated');
  assert(skillMd!.content.includes('name: complex-skill'), '5.1 CC emit: name in frontmatter');
  assert(skillMd!.content.includes('allowed-tools'), '5.1 CC emit: allowed-tools preserved');
  assert(skillMd!.content.includes('context: fork'), '5.1 CC emit: subagent config');

  const nativeCount = result.warnings.filter(w => w.level === 'native').length;
  assert(nativeCount >= 3, '5.1 CC emit: most features native');
  assert(result.parity.score >= 80, '5.1 CC emit: high parity');

  // Check scripts were copied
  const scriptFiles = result.files.filter(f => f.path.includes('scripts/'));
  assert(scriptFiles.length >= 1, '5.1 CC emit: scripts copied');

  // Check references
  const refFiles = result.files.filter(f => f.path.includes('references/'));
  assert(refFiles.length >= 1, '5.1 CC emit: references copied');

  fs.rmSync(out, { recursive: true });
}

// 5.2 Emit to Cursor
{
  const ir = buildComplexIR();
  const out = tmpDir();
  const result = emitCursorSkill(ir, out);

  assert(result.files.length >= 1, '5.2 Cursor emit: files generated');
  const skillMd = result.files.find(f => f.path.endsWith('SKILL.md'));
  assert(skillMd !== undefined, '5.2 Cursor emit: SKILL.md generated');
  assert(skillMd!.content.includes('Tool restrictions'), '5.2 Cursor emit: tool restrictions shimmed');
  assert(skillMd!.content.includes('SKILLPORT'), '5.2 Cursor emit: has SKILLPORT annotations');

  const shimmed = result.warnings.filter(w => w.level === 'shimmed');
  const dropped = result.warnings.filter(w => w.level === 'dropped');
  assert(shimmed.length >= 1, '5.2 Cursor emit: has shimmed features');
  assert(dropped.length >= 1, '5.2 Cursor emit: has dropped features (prompt hook type)');
  assert(result.parity.score < 100, '5.2 Cursor emit: parity < 100 (features lost)');
  assert(result.parity.score > 30, '5.2 Cursor emit: parity > 30 (core preserved)');

  fs.rmSync(out, { recursive: true });
}

// 5.3 Emit to Codex
{
  const ir = buildComplexIR();
  const out = tmpDir();
  const result = emitCodexSkill(ir, out);

  assert(result.files.length >= 1, '5.3 Codex emit: files generated');
  const skillMd = result.files.find(f => f.path.endsWith('SKILL.md'));
  assert(skillMd !== undefined, '5.3 Codex emit: SKILL.md generated');

  // Should have openai.yaml since we have codex-specific metadata
  const openaiYaml = result.files.find(f => f.path.includes('openai.yaml'));
  assert(openaiYaml !== undefined, '5.3 Codex emit: openai.yaml generated');
  assert(openaiYaml!.content.includes('Complex Skill'), '5.3 Codex emit: displayName in openai.yaml');

  // Hooks should be dropped with wrapper scripts
  const hookScripts = result.files.filter(f => f.path.includes('hook-'));
  assert(hookScripts.length >= 1, '5.3 Codex emit: hook wrapper scripts generated');

  const dropped = result.warnings.filter(w => w.level === 'dropped');
  assert(dropped.length >= 1, '5.3 Codex emit: hooks marked as dropped');

  fs.rmSync(out, { recursive: true });
}

// 5.4 Emit to OpenClaw
{
  const ir = buildComplexIR();
  const out = tmpDir();
  const result = emitOpenClawSkill(ir, out);

  assert(result.files.length >= 1, '5.4 OpenClaw emit: files generated');
  const skillMd = result.files.find(f => f.path.endsWith('SKILL.md'));
  assert(skillMd !== undefined, '5.4 OpenClaw emit: SKILL.md generated');
  assert(skillMd!.content.includes('Tool restrictions'), '5.4 OpenClaw emit: tool restrictions shimmed');

  // Hooks and subagent should be dropped
  const dropped = result.warnings.filter(w => w.level === 'dropped');
  assert(dropped.length >= 2, '5.4 OpenClaw emit: hooks + subagent dropped');

  // Dynamic context should be shimmed as preamble
  assert(skillMd!.content.includes('Preamble'), '5.4 OpenClaw emit: preamble for dynamic context');

  assert(result.parity.score < 80, '5.4 OpenClaw emit: lower parity (many features dropped)');

  fs.rmSync(out, { recursive: true });
}

// 5.5 Emit to Copilot
{
  const ir = buildComplexIR();
  const out = tmpDir();
  const result = emitCopilotInstructions(ir, out);

  assert(result.files.length === 1, '5.5 Copilot emit: one file');
  const file = result.files[0];
  assert(file.path.includes('.github/instructions/'), '5.5 Copilot emit: correct path (non-root, has globs)');
  assert(file.content.includes('applyTo'), '5.5 Copilot emit: applyTo field present');

  const dropped = result.warnings.filter(w => w.level === 'dropped');
  assert(dropped.length >= 3, '5.5 Copilot emit: many features dropped');

  fs.rmSync(out, { recursive: true });
}

// 5.6 Emit to Windsurf
{
  const ir = buildComplexIR();
  const out = tmpDir();
  const result = emitWindsurfRules(ir, out);

  assert(result.files.length === 1, '5.6 Windsurf emit: one file');
  const file = result.files[0];
  assert(file.path.includes('.windsurf/rules/'), '5.6 Windsurf emit: correct path');
  assert(file.content.includes('Complex Skill'), '5.6 Windsurf emit: body preserved');

  const dropped = result.warnings.filter(w => w.level === 'dropped');
  assert(dropped.length >= 3, '5.6 Windsurf emit: most features dropped');

  assert(result.parity.score < 60, '5.6 Windsurf emit: low parity');

  fs.rmSync(out, { recursive: true });
}

// 5.7 Emit simple IR (no advanced features)
{
  const simpleIR: SkillIR = {
    name: 'simple',
    description: 'A simple skill',
    body: '# Simple\n\nDo things.',
    activation: { mode: 'intelligent' },
    sourceFormat: 'claude',
    sourceFiles: ['/test/SKILL.md'],
  };
  const out = tmpDir();

  const ccResult = emitClaudeSkill(simpleIR, out);
  assert(ccResult.parity.score === 100, '5.7 Simple → CC: 100% parity');

  const cursorResult = emitCursorSkill(simpleIR, out);
  assert(cursorResult.parity.score === 100, '5.7 Simple → Cursor: 100% parity');

  const codexResult = emitCodexSkill(simpleIR, out);
  assert(codexResult.parity.score === 100, '5.7 Simple → Codex: 100% parity');

  fs.rmSync(out, { recursive: true });
}

// 5.8 emitClaudeMd (rule-type conversion)
{
  const ir: SkillIR = {
    name: 'test-rules',
    description: 'Test rules',
    body: '# Rules\n\nBe helpful.',
    activation: { mode: 'always' },
    sourceFormat: 'cursor',
    sourceFiles: ['/test/test.mdc'],
  };
  const out = tmpDir();
  const result = emitClaudeMd(ir, out);
  assert(result.files.length === 1, '5.8 emitClaudeMd: one file');
  assert(result.files[0].path.endsWith('CLAUDE.md'), '5.8 emitClaudeMd: outputs CLAUDE.md for always mode');
  fs.rmSync(out, { recursive: true });
}

// 5.9 emitClaudeMd with globs (scoped rule)
{
  const ir: SkillIR = {
    name: 'scoped-rules',
    description: 'Scoped',
    body: '# Scoped',
    activation: { mode: 'glob', globs: ['src/**/*.ts'] },
    sourceFormat: 'cursor',
    sourceFiles: ['/test/test.mdc'],
  };
  const out = tmpDir();
  const result = emitClaudeMd(ir, out);
  assert(result.files[0].path.includes('.claude/rules/'), '5.9 emitClaudeMd scoped: goes to .claude/rules/');
  assert(result.files[0].content.includes('paths'), '5.9 emitClaudeMd scoped: has paths frontmatter');
  fs.rmSync(out, { recursive: true });
}

// 5.10 emitAgentsMd
{
  const ir: SkillIR = {
    name: 'test',
    description: 'Test',
    body: '# Content',
    activation: { mode: 'always' },
    sourceFormat: 'claude',
    sourceFiles: [],
  };
  const out = tmpDir();
  const result = emitAgentsMd(ir, out);
  assert(result.files[0].path.endsWith('AGENTS.md'), '5.10 emitAgentsMd: outputs AGENTS.md');
  fs.rmSync(out, { recursive: true });
}

// 5.11 emitAgentsMd with globs
{
  const ir: SkillIR = {
    name: 'test',
    description: 'Test',
    body: '# Content',
    activation: { mode: 'glob', globs: ['**/*.py'] },
    sourceFormat: 'cursor',
    sourceFiles: [],
  };
  const out = tmpDir();
  const result = emitAgentsMd(ir, out);
  assert(result.files[0].content.includes('**/*.py'), '5.11 emitAgentsMd with globs: glob annotated');
  fs.rmSync(out, { recursive: true });
}

// 5.12 Copilot emit — always mode goes to root file
{
  const ir: SkillIR = {
    name: 'base',
    description: 'Base rules',
    body: '# Rules',
    activation: { mode: 'always' },
    sourceFormat: 'claude',
    sourceFiles: [],
  };
  const out = tmpDir();
  const result = emitCopilotInstructions(ir, out);
  assert(result.files[0].path.includes('copilot-instructions.md'), '5.12 Copilot always: root file');
  fs.rmSync(out, { recursive: true });
}

// ═══════════════════════════════════════════════════════════
// 6. ROUND-TRIP TESTS
// ═══════════════════════════════════════════════════════════

section('6. Round-Trip Conversions');

// 6.1 CC → Cursor → CC
{
  const dir = tmpDir();
  writeFile(dir, 'original/SKILL.md', `---
name: roundtrip-test
description: Test skill for round-trip
version: 1.0.0
---

# Roundtrip Test

This is the body content.

## Section 2

More content here.`);

  // Parse as CC
  const ir1 = parseClaudeSkill(path.join(dir, 'original'));
  assert(ir1.name === 'roundtrip-test', '6.1 RT CC→Cursor→CC: initial parse name');

  // Emit to Cursor
  const out1 = tmpDir();
  const cursorResult = emitCursorSkill(ir1, out1);
  const cursorSkillMd = cursorResult.files.find(f => f.path.endsWith('SKILL.md'));
  assert(cursorSkillMd !== undefined, '6.1 RT CC→Cursor→CC: cursor SKILL.md exists');

  // Write it
  for (const f of cursorResult.files) {
    fs.mkdirSync(path.dirname(f.path), { recursive: true });
    fs.writeFileSync(f.path, f.content);
  }

  // Parse cursor output
  const cursorSkillDir = path.dirname(cursorSkillMd!.path);
  const ir2 = parseCursorSkill(cursorSkillDir);
  assert(ir2.name === 'roundtrip-test', '6.1 RT CC→Cursor→CC: cursor parsed name');
  assert(ir2.description === 'Test skill for round-trip', '6.1 RT CC→Cursor→CC: cursor parsed description');

  // Emit back to CC
  const out2 = tmpDir();
  const ccResult = emitClaudeSkill(ir2, out2);
  const finalSkillMd = ccResult.files.find(f => f.path.endsWith('SKILL.md'));
  assert(finalSkillMd !== undefined, '6.1 RT CC→Cursor→CC: final SKILL.md exists');
  assert(finalSkillMd!.content.includes('roundtrip-test'), '6.1 RT CC→Cursor→CC: name survived');
  assert(finalSkillMd!.content.includes('Roundtrip'), '6.1 RT CC→Cursor→CC: body survived (partial)');
  assert(finalSkillMd!.content.includes('Section 2'), '6.1 RT CC→Cursor→CC: body section 2 survived');

  fs.rmSync(dir, { recursive: true });
  fs.rmSync(out1, { recursive: true });
  fs.rmSync(out2, { recursive: true });
}

// 6.2 CC → Codex → CC
{
  const dir = tmpDir();
  writeFile(dir, 'original/SKILL.md', `---
name: codex-rt
description: Codex round-trip test
---

# Content

Body text.`);

  const ir1 = parseClaudeSkill(path.join(dir, 'original'));
  const out1 = tmpDir();
  const codexResult = emitCodexSkill(ir1, out1);

  for (const f of codexResult.files) {
    fs.mkdirSync(path.dirname(f.path), { recursive: true });
    fs.writeFileSync(f.path, f.content);
  }

  const codexSkillDir = path.dirname(codexResult.files.find(f => f.path.endsWith('SKILL.md'))!.path);
  const ir2 = parseCodexSkill(codexSkillDir);
  assert(ir2.name === 'codex-rt', '6.2 RT CC→Codex→CC: name survived');
  assert(ir2.body.includes('Body text'), '6.2 RT CC→Codex→CC: body survived');

  fs.rmSync(dir, { recursive: true });
  fs.rmSync(out1, { recursive: true });
}

// 6.3 Cursor → CC → Cursor
{
  const dir = tmpDir();
  const mdcFile = writeFile(dir, 'style.mdc', `---
description: Code style rules
alwaysApply: true
---

# Style

Use 2-space indentation.`);

  const ir1 = parseCursorMdc(mdcFile);
  assert(ir1.activation.mode === 'always', '6.3 RT Cursor→CC→Cursor: initial always mode');

  const out1 = tmpDir();
  const ccResult = emitClaudeMd(ir1, out1);
  for (const f of ccResult.files) {
    fs.mkdirSync(path.dirname(f.path), { recursive: true });
    fs.writeFileSync(f.path, f.content);
  }

  const claudeMdFile = ccResult.files[0].path;
  const ir2 = parseClaudeMd(claudeMdFile);
  assert(ir2.body.includes('2-space indentation'), '6.3 RT Cursor→CC→Cursor: body survived');
  assert(ir2.activation.mode === 'always', '6.3 RT Cursor→CC→Cursor: always mode survived');

  fs.rmSync(dir, { recursive: true });
  fs.rmSync(out1, { recursive: true });
}

// ═══════════════════════════════════════════════════════════
// 7. EDGE CASES
// ═══════════════════════════════════════════════════════════

section('7. Edge Cases');

// 7.1 Skill with empty body
{
  const dir = tmpDir();
  writeFile(dir, 'empty/SKILL.md', '---\nname: empty\ndescription: Empty body skill\n---\n');
  const ir = parseClaudeSkill(path.join(dir, 'empty'));
  assert(ir.name === 'empty', '7.1 Empty body: name parsed');
  assert(ir.body === '', '7.1 Empty body: body is empty string');

  const out = tmpDir();
  const result = emitCursorSkill(ir, out);
  assert(result.files.length >= 1, '7.1 Empty body: cursor emit succeeds');
  fs.rmSync(dir, { recursive: true });
  fs.rmSync(out, { recursive: true });
}

// 7.2 Skill with special characters in name
{
  const dir = tmpDir();
  writeFile(dir, 'my-cool_skill.v2/SKILL.md', '---\nname: my-cool_skill.v2\n---\nContent');
  const ir = parseClaudeSkill(path.join(dir, 'my-cool_skill.v2'));
  assert(ir.name === 'my-cool_skill.v2', '7.2 Special chars in name: preserved');
  fs.rmSync(dir, { recursive: true });
}

// 7.3 Very long description
{
  const longDesc = 'A'.repeat(5000);
  const dir = tmpDir();
  writeFile(dir, 'long/SKILL.md', `---\nname: long\ndescription: "${longDesc}"\n---\nContent`);
  const ir = parseClaudeSkill(path.join(dir, 'long'));
  assert(ir.description.length === 5000, '7.3 Long description: preserved');
  fs.rmSync(dir, { recursive: true });
}

// 7.4 Body with markdown code blocks containing ---
{
  const body = '# Skill\n\n```yaml\n---\nkey: value\n---\n```\n\nMore content.';
  const dir = tmpDir();
  writeFile(dir, 'codeblock/SKILL.md', `---\nname: codeblock\n---\n\n${body}`);
  const ir = parseClaudeSkill(path.join(dir, 'codeblock'));
  assert(ir.name === 'codeblock', '7.4 Code block with ---: name parsed');
  assert(ir.body.includes('More content'), '7.4 Code block with ---: body includes trailing content');
  fs.rmSync(dir, { recursive: true });
}

// 7.5 Unicode content
{
  const dir = tmpDir();
  writeFile(dir, 'unicode/SKILL.md', '---\nname: unicode-skill\ndescription: "Skill with emoji and CJK: 技术文档 🚀"\n---\n\n# 技术文档\n\nContent with 日本語 and émojis 🎉');
  const ir = parseClaudeSkill(path.join(dir, 'unicode'));
  assert(ir.description.includes('技术文档'), '7.5 Unicode: CJK in description');
  assert(ir.body.includes('日本語'), '7.5 Unicode: CJK in body');
  assert(ir.body.includes('🎉'), '7.5 Unicode: emoji in body');

  const out = tmpDir();
  const result = emitCursorSkill(ir, out);
  const skillMd = result.files.find(f => f.path.endsWith('SKILL.md'));
  assert(skillMd!.content.includes('技术文档'), '7.5 Unicode: survives Cursor emit');
  fs.rmSync(dir, { recursive: true });
  fs.rmSync(out, { recursive: true });
}

// 7.6 Multiple dynamic context placeholders
{
  const dir = tmpDir();
  writeFile(dir, 'multi-dc/SKILL.md', `---
name: multi-dc
---

Status: !${'`'}git status${'`'}
Branch: !${'`'}git branch --show-current${'`'}
Remote: !${'`'}git remote -v${'`'}`);
  const ir = parseClaudeSkill(path.join(dir, 'multi-dc'));
  assert(ir.dynamicContext?.length === 3, '7.6 Multiple dynamic context: found 3');
  assert(ir.dynamicContext?.[0].command === 'git status', '7.6 Multiple DC: first command');
  assert(ir.dynamicContext?.[1].command === 'git branch --show-current', '7.6 Multiple DC: second command');
  assert(ir.dynamicContext?.[2].command === 'git remote -v', '7.6 Multiple DC: third command');
  fs.rmSync(dir, { recursive: true });
}

// 7.7 Hooks with multiple events
{
  const dir = tmpDir();
  writeFile(dir, 'hooked/SKILL.md', `---
name: hooked
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./check.sh"
          timeout: 3000
  PostToolUse:
    - matcher: "Edit"
      hooks:
        - type: command
          command: "./post-edit.sh"
---

Content`);
  const ir = parseClaudeSkill(path.join(dir, 'hooked'));
  assert(ir.hooks?.length === 2, '7.7 Multiple hooks: found 2');
  assert(ir.hooks?.[0].event === 'PreToolUse', '7.7 Hooks: first event');
  assert(ir.hooks?.[0].matcher === 'Bash', '7.7 Hooks: first matcher');
  assert(ir.hooks?.[0].handler.timeout === 3000, '7.7 Hooks: timeout preserved');
  assert(ir.hooks?.[0].canBlock === true, '7.7 Hooks: PreToolUse can block');
  assert(ir.hooks?.[1].event === 'PostToolUse', '7.7 Hooks: second event');
  assert(ir.hooks?.[1].canBlock === false, '7.7 Hooks: PostToolUse cannot block');
  fs.rmSync(dir, { recursive: true });
}

// 7.8 Emit hooks to all targets and verify annotations
{
  const ir: SkillIR = {
    name: 'hook-test',
    description: 'Test hooks across harnesses',
    body: '# Content',
    activation: { mode: 'intelligent' },
    hooks: [
      { event: 'PreToolUse', matcher: 'Bash', handler: { type: 'command', value: './check.sh' }, canBlock: true },
      { event: 'SessionStart', handler: { type: 'prompt', value: 'Initialize context' }, canBlock: false },
    ],
    sourceFormat: 'claude',
    sourceFiles: [],
  };

  const out = tmpDir();

  // Cursor should shim PreToolUse and drop SessionStart/prompt
  const cursorResult = emitCursorSkill(ir, out);
  const cursorShimmed = cursorResult.warnings.filter(w => w.level === 'shimmed');
  const cursorDropped = cursorResult.warnings.filter(w => w.level === 'dropped');
  assert(cursorShimmed.length >= 1, '7.8 Hooks→Cursor: PreToolUse shimmed');
  assert(cursorDropped.length >= 1, '7.8 Hooks→Cursor: prompt handler dropped');

  // Codex should drop all with wrapper scripts
  const codexResult = emitCodexSkill(ir, out);
  const codexDropped = codexResult.warnings.filter(w => w.level === 'dropped');
  assert(codexDropped.length >= 1, '7.8 Hooks→Codex: hooks dropped');
  const codexScripts = codexResult.files.filter(f => f.path.includes('hook-'));
  assert(codexScripts.length >= 1, '7.8 Hooks→Codex: wrapper script generated');

  // Windsurf should drop all
  const wsResult = emitWindsurfRules(ir, out);
  const wsDropped = wsResult.warnings.filter(w => w.level === 'dropped');
  assert(wsDropped.length >= 1, '7.8 Hooks→Windsurf: hooks dropped');

  fs.rmSync(out, { recursive: true });
}

// 7.9 Skill directory with no scripts/references dirs
{
  const dir = tmpDir();
  writeFile(dir, 'no-extras/SKILL.md', '---\nname: no-extras\n---\nContent');
  const ir = parseClaudeSkill(path.join(dir, 'no-extras'));
  assert(ir.scripts === undefined || ir.scripts?.length === 0, '7.9 No extras: no scripts');
  assert(ir.references === undefined || ir.references?.length === 0, '7.9 No extras: no references');
  fs.rmSync(dir, { recursive: true });
}

// 7.10 Converting to same format
{
  const dir = tmpDir();
  writeFile(dir, 'same/SKILL.md', '---\nname: same\ndescription: Convert to same format\n---\nContent');
  const ir = parseClaudeSkill(path.join(dir, 'same'));
  const out = tmpDir();
  const result = emitClaudeSkill(ir, out);
  assert(result.parity.score === 100, '7.10 Same format: 100% parity');
  assert(result.warnings.every(w => w.level === 'native'), '7.10 Same format: all native');
  fs.rmSync(dir, { recursive: true });
  fs.rmSync(out, { recursive: true });
}

// ═══════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════

console.log('\n' + '═'.repeat(60));
console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);

if (failures.length > 0) {
  console.log('  Failures:');
  for (const f of failures) {
    console.log(`    ✗ ${f}`);
  }
  console.log('');
  process.exit(1);
} else {
  console.log('  All tests passed!\n');
  process.exit(0);
}
