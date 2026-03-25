import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { parseFrontmatter, serializeFrontmatter } from '../src/utils/frontmatter.js';
import { buildParity, formatReport } from '../src/utils/warnings.js';
import { detectFormat, scanProject } from '../src/detect.js';
import { computeParityLevel, computeParityScore } from '../src/ir.js';
import type { SkillIR, FeatureParity, ConversionWarning } from '../src/ir.js';

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

// ─── Helpers ──────────────────────────────────────────────

let tmpDirs: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillport-test-'));
  tmpDirs.push(dir);
  return dir;
}

function writeFile(dir: string, filePath: string, content: string): string {
  const full = path.join(dir, filePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  return full;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

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
    hooks: [
      { event: 'PreToolUse', matcher: 'Bash', handler: { type: 'command', value: './scripts/pre-check.sh', timeout: 5000 }, canBlock: true },
      { event: 'PostToolUse', handler: { type: 'prompt', value: 'Verify the output is safe' }, canBlock: false },
    ],
    subagent: { enabled: true, agentType: 'Explore', isolation: 'fork' },
    dynamicContext: [{ placeholder: '!`git log --oneline -5`', command: 'git log --oneline -5' }],
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

// ═══════════════════════════════════════════════════════════
// 1. FRONTMATTER
// ═══════════════════════════════════════════════════════════

describe('Frontmatter Parser', () => {
  it('parses standard frontmatter', () => {
    const r = parseFrontmatter('---\nname: test-skill\ndescription: A test skill\n---\n\n# Body here\n\nSome content.');
    expect(r.frontmatter['name']).toBe('test-skill');
    expect(r.frontmatter['description']).toBe('A test skill');
    expect(r.body).toMatch(/^# Body here/);
  });

  it('handles no frontmatter', () => {
    const r = parseFrontmatter('# Just markdown\n\nNo frontmatter here.');
    expect(Object.keys(r.frontmatter)).toHaveLength(0);
    expect(r.body).toMatch(/^# Just markdown/);
  });

  it('handles empty string', () => {
    const r = parseFrontmatter('');
    expect(Object.keys(r.frontmatter)).toHaveLength(0);
    expect(r.body).toBe('');
  });

  it('handles frontmatter only, no body', () => {
    const r = parseFrontmatter('---\nname: no-body\n---');
    expect(r.frontmatter['name']).toBe('no-body');
    expect(r.body).toBe('');
  });

  it('falls back gracefully on malformed YAML', () => {
    const r = parseFrontmatter('---\nname: broken\nthis is not valid');
    expect(Object.keys(r.frontmatter)).toHaveLength(0);
    expect(r.body).toContain('name: broken');
  });

  it('parses .mdc unquoted glob values', () => {
    const r = parseFrontmatter('---\ndescription: Test rule\nalwaysApply: false\nglobs: src/**/*.ts, tests/**/*.test.ts\n---\n\nRule content');
    expect(r.frontmatter['alwaysApply']).toBe(false);
    const globs = r.frontmatter['globs'] as string[];
    expect(Array.isArray(globs)).toBe(true);
    expect(globs).toHaveLength(2);
    expect(globs[0]).toContain('src/');
  });

  it('parses .mdc comma-separated quoted globs', () => {
    const r = parseFrontmatter('---\ndescription: Test\nglobs: "**/*.test.ts", "**/*.spec.ts"\n---\n\nContent');
    const globs = r.frontmatter['globs'] as string[];
    expect(Array.isArray(globs)).toBe(true);
    expect(globs).toHaveLength(2);
  });

  it('parses multiline description (pipe)', () => {
    const r = parseFrontmatter('---\nname: multi\ndescription: |\n  This is a multiline\n  description value\n---\n\nBody');
    expect(r.frontmatter['name']).toBe('multi');
    expect(r.frontmatter['description'] as string).toContain('multiline');
  });

  it('parses allowed-tools array', () => {
    const r = parseFrontmatter('---\nname: restricted\nallowed-tools:\n  - Bash\n  - Read\n  - Grep\n---\n\nContent');
    const tools = r.frontmatter['allowed-tools'] as string[];
    expect(tools).toHaveLength(3);
    expect(tools[0]).toBe('Bash');
  });

  it('handles triple dashes in body', () => {
    const r = parseFrontmatter('---\nname: dashes\n---\n\nSome content\n\n---\n\nMore content after horizontal rule');
    expect(r.frontmatter['name']).toBe('dashes');
    expect(r.body).toContain('horizontal rule');
  });

  it('survives serialization roundtrip', () => {
    const fm = { name: 'roundtrip', description: 'A test', version: '1.0.0' };
    const serialized = serializeFrontmatter(fm, '# Test\n\nContent here.');
    const parsed = parseFrontmatter(serialized);
    expect(parsed.frontmatter['name']).toBe('roundtrip');
    expect(parsed.frontmatter['description']).toBe('A test');
    expect(parsed.body).toContain('Content here');
  });

  it('serializes empty frontmatter as body only', () => {
    const s = serializeFrontmatter({}, 'Just body');
    expect(s).not.toContain('---');
    expect(s).toBe('Just body');
  });

  it('serializes in MDC mode', () => {
    const s = serializeFrontmatter({ description: 'Test', alwaysApply: true, globs: ['src/**/*.ts'] }, 'Body', { mdcMode: true });
    expect(s).toContain('alwaysApply: true');
    expect(s).toContain('globs:');
  });
});

// ═══════════════════════════════════════════════════════════
// 2. DETECTION
// ═══════════════════════════════════════════════════════════

describe('Format Detection', () => {
  it('detects .mdc file', () => {
    const dir = tmp();
    const f = writeFile(dir, 'test.mdc', '---\ndescription: Test\n---\nContent');
    const r = detectFormat(f);
    expect(r).not.toBeNull();
    expect(r!.harness).toBe('cursor');
    expect(r!.confidence).toBe('high');
  });

  it('detects CLAUDE.md', () => {
    const f = writeFile(tmp(), 'CLAUDE.md', '# Rules');
    expect(detectFormat(f)!.harness).toBe('claude');
  });

  it('detects AGENTS.md', () => {
    const f = writeFile(tmp(), 'AGENTS.md', '# Instructions');
    expect(detectFormat(f)!.harness).toBe('codex');
  });

  it('detects .cursorrules', () => {
    const f = writeFile(tmp(), '.cursorrules', 'Legacy');
    expect(detectFormat(f)!.harness).toBe('cursor');
  });

  it('detects .windsurfrules', () => {
    const f = writeFile(tmp(), '.windsurfrules', 'Rules');
    expect(detectFormat(f)!.harness).toBe('windsurf');
  });

  it('detects .claude/skills/ path', () => {
    const dir = tmp();
    writeFile(dir, '.claude/skills/test/SKILL.md', '---\nname: test\nallowed-tools:\n  - Bash\n---\nContent');
    expect(detectFormat(path.join(dir, '.claude', 'skills', 'test'))!.harness).toBe('claude');
  });

  it('detects .agents/skills/ with openai.yaml as codex', () => {
    const dir = tmp();
    writeFile(dir, '.agents/skills/test/SKILL.md', '---\nname: test\n---\nContent');
    writeFile(dir, '.agents/skills/test/openai.yaml', 'interface:\n  display_name: Test');
    const r = detectFormat(path.join(dir, '.agents', 'skills', 'test'));
    expect(r!.harness).toBe('codex');
    expect(r!.confidence).toBe('high');
  });

  it('detects SKILL.md with CC-specific frontmatter', () => {
    const dir = tmp();
    writeFile(dir, 'my-skill/SKILL.md', '---\nname: test\nallowed-tools:\n  - Bash\ncontext: fork\n---\nContent');
    expect(detectFormat(path.join(dir, 'my-skill'))!.harness).toBe('claude');
  });

  it('returns null for nonexistent path', () => {
    expect(detectFormat('/nonexistent/path')).toBeNull();
  });

  it('defaults generic SKILL.md to claude with low confidence', () => {
    const dir = tmp();
    writeFile(dir, 'generic/SKILL.md', '---\nname: generic\ndescription: Generic\n---\nContent');
    const r = detectFormat(path.join(dir, 'generic'));
    expect(r!.harness).toBe('claude');
    expect(r!.confidence).toBe('low');
  });

  it('scans project for multiple configs', () => {
    const dir = tmp();
    writeFile(dir, 'CLAUDE.md', '# Rules');
    writeFile(dir, 'AGENTS.md', '# Agent');
    writeFile(dir, '.cursor/rules/test.mdc', '---\ndescription: Test\n---\nContent');
    writeFile(dir, '.github/copilot-instructions.md', '# Copilot');
    const results = scanProject(dir);
    expect(results.length).toBeGreaterThanOrEqual(3);
    const harnesses = results.map(r => r.harness);
    expect(harnesses).toContain('claude');
    expect(harnesses).toContain('codex');
    expect(harnesses).toContain('cursor');
  });

  it('returns empty array for empty project', () => {
    expect(scanProject(tmp())).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════
// 3. PARITY & WARNINGS
// ═══════════════════════════════════════════════════════════

describe('Parity & Warnings', () => {
  it('scores empty features as 100%', () => {
    expect(computeParityScore([])).toBe(100);
  });

  it('computes mixed feature score', () => {
    const f: FeatureParity[] = [
      { feature: 'A', status: 'native', percent: 100, notes: '' },
      { feature: 'B', status: 'shimmed', percent: 50, notes: '' },
    ];
    expect(computeParityScore(f)).toBe(75);
  });

  it.each([
    [100, 'full'], [95, 'full'],
    [94, 'high'], [80, 'high'],
    [79, 'partial'], [50, 'partial'],
    [49, 'low'], [0, 'low'],
  ] as const)('maps score %i to level "%s"', (score, expected) => {
    expect(computeParityLevel(score)).toBe(expected);
  });

  it('buildParity includes skill name in verdict', () => {
    const f: FeatureParity[] = [
      { feature: 'Core', status: 'native', percent: 100, notes: 'ok' },
      { feature: 'Hooks', status: 'dropped', percent: 0, notes: 'gone' },
    ];
    const p = buildParity(f, { name: 'test' } as SkillIR);
    expect(p.score).toBe(50);
    expect(p.level).toBe('partial');
    expect(p.verdict).toContain('test');
  });

  it('formatReport includes all sections', () => {
    const warnings: ConversionWarning[] = [
      { field: 'body', level: 'native', message: 'Preserved' },
      { field: 'hooks', level: 'dropped', message: 'No equivalent' },
    ];
    const f: FeatureParity[] = [{ feature: 'Core', status: 'native', percent: 100, notes: 'ok' }];
    const p = buildParity(f, { name: 'test' } as SkillIR);
    const report = formatReport('test', 'claude', 'cursor', '/src', '/dst', warnings, p);
    expect(report).toContain('test');
    expect(report).toContain('claude');
    expect(report).toContain('cursor');
    expect(report).toContain('Key Points');
    expect(report).toContain('No equivalent');
  });
});

// ═══════════════════════════════════════════════════════════
// 4. PARSERS
// ═══════════════════════════════════════════════════════════

describe('Claude Parser', () => {
  it('parses fully featured skill', () => {
    const dir = tmp();
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

Run this: !\`git status\`

Then do stuff.`);
    writeFile(dir, 'my-skill/scripts/check.sh', '#!/bin/bash\necho ok');
    writeFile(dir, 'my-skill/references/guide.md', '# Guide');

    const ir = parseClaudeSkill(path.join(dir, 'my-skill'));
    expect(ir.name).toBe('full-skill');
    expect(ir.description).toBe('A fully featured skill');
    expect(ir.version).toBe('2.0.0');
    expect(ir.allowedTools).toHaveLength(2);
    expect(ir.allowedTools![0]).toBe('Bash');
    expect(ir.subagent).toEqual({ enabled: true, agentType: 'Explore', isolation: 'fork' });
    expect(ir.model).toBe('opus');
    expect(ir.effort).toBe('high');
    expect(ir.activation.mode).toBe('explicit');
    expect(ir.dynamicContext).toHaveLength(1);
    expect(ir.dynamicContext![0].command).toBe('git status');
    expect(ir.scripts!.length).toBeGreaterThanOrEqual(1);
    expect(ir.references).toHaveLength(1);
    expect(ir.sourceFormat).toBe('claude');
    expect(ir.harnessSpecific?.claude?.disableModelInvocation).toBe(true);
  });

  it('parses minimal skill', () => {
    const dir = tmp();
    writeFile(dir, 'minimal/SKILL.md', '---\nname: minimal\n---\nJust content.');
    const ir = parseClaudeSkill(path.join(dir, 'minimal'));
    expect(ir.name).toBe('minimal');
    expect(ir.description).toBe('');
    expect(ir.body).toBe('Just content.');
    expect(ir.allowedTools).toBeUndefined();
    expect(ir.hooks).toBeUndefined();
    expect(ir.subagent).toBeUndefined();
  });

  it('uses directory name when no frontmatter', () => {
    const dir = tmp();
    writeFile(dir, 'bare/SKILL.md', '# Just markdown\n\nNo frontmatter.');
    const ir = parseClaudeSkill(path.join(dir, 'bare'));
    expect(ir.name).toBe('bare');
    expect(ir.body).toContain('Just markdown');
  });

  it('parses CLAUDE.md as always-applied rule', () => {
    const f = writeFile(tmp(), 'CLAUDE.md', '# Project Rules\n\nBe concise.');
    const ir = parseClaudeMd(f);
    expect(ir.activation.mode).toBe('always');
    expect(ir.body).toContain('Be concise');
    expect(ir.sourceFormat).toBe('claude');
  });

  it('parses CLAUDE.md with paths as glob-scoped rule', () => {
    const f = writeFile(tmp(), 'CLAUDE.md', '---\npaths:\n  - src/**/*.ts\n---\n# Scoped rules');
    const ir = parseClaudeMd(f);
    expect(ir.activation.mode).toBe('glob');
    expect(ir.activation.globs).toHaveLength(1);
  });

  it('parses hooks from frontmatter', () => {
    const dir = tmp();
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
    expect(ir.hooks).toHaveLength(2);
    expect(ir.hooks![0].event).toBe('PreToolUse');
    expect(ir.hooks![0].matcher).toBe('Bash');
    expect(ir.hooks![0].handler.timeout).toBe(3000);
    expect(ir.hooks![0].canBlock).toBe(true);
    expect(ir.hooks![1].event).toBe('PostToolUse');
    expect(ir.hooks![1].canBlock).toBe(false);
  });

  it('extracts multiple dynamic context placeholders', () => {
    const dir = tmp();
    writeFile(dir, 'dc/SKILL.md', '---\nname: dc\n---\n\nStatus: !`git status`\nBranch: !`git branch --show-current`\nRemote: !`git remote -v`');
    const ir = parseClaudeSkill(path.join(dir, 'dc'));
    expect(ir.dynamicContext).toHaveLength(3);
    expect(ir.dynamicContext![0].command).toBe('git status');
    expect(ir.dynamicContext![1].command).toBe('git branch --show-current');
    expect(ir.dynamicContext![2].command).toBe('git remote -v');
  });
});

describe('Cursor Parser', () => {
  it('parses .mdc with globs', () => {
    const f = writeFile(tmp(), 'testing.mdc', '---\ndescription: Testing conventions\nalwaysApply: false\nglobs: "**/*.test.ts", "**/*.spec.ts"\n---\n\n# Testing Rules');
    const ir = parseCursorMdc(f);
    expect(ir.name).toBe('testing');
    expect(ir.description).toBe('Testing conventions');
    expect(ir.activation.mode).toBe('glob');
    expect(ir.activation.globs).toHaveLength(2);
  });

  it('parses alwaysApply as always mode', () => {
    const f = writeFile(tmp(), 'base.mdc', '---\ndescription: Base\nalwaysApply: true\n---\n# Base');
    const ir = parseCursorMdc(f);
    expect(ir.activation.mode).toBe('always');
    expect(ir.harnessSpecific?.cursor?.alwaysApply).toBe(true);
  });

  it('parses manual mode (no desc, no globs, not always)', () => {
    const f = writeFile(tmp(), 'manual.mdc', '---\nalwaysApply: false\n---\n# Manual');
    expect(parseCursorMdc(f).activation.mode).toBe('manual');
  });

  it('parses legacy .cursorrules', () => {
    const f = writeFile(tmp(), '.cursorrules', 'Be helpful.\nWrite clean code.');
    const ir = parseCursorrules(f);
    expect(ir.name).toBe('cursorrules');
    expect(ir.activation.mode).toBe('always');
    expect(ir.body).toContain('clean code');
  });

  it('parses cursor skill directory', () => {
    const dir = tmp();
    writeFile(dir, 'cs/SKILL.md', '---\nname: cs-test\ndescription: Cursor skill\n---\nContent');
    writeFile(dir, 'cs/scripts/run.sh', '#!/bin/bash\necho hi');
    const ir = parseCursorSkill(path.join(dir, 'cs'));
    expect(ir.name).toBe('cs-test');
    expect(ir.scripts).toHaveLength(1);
    expect(ir.sourceFormat).toBe('cursor');
  });
});

describe('Codex Parser', () => {
  it('parses codex skill', () => {
    const dir = tmp();
    writeFile(dir, 'cx/SKILL.md', '---\nname: cx-test\ndescription: Codex skill\n---\nContent');
    const ir = parseCodexSkill(path.join(dir, 'cx'));
    expect(ir.name).toBe('cx-test');
    expect(ir.sourceFormat).toBe('codex');
    expect(ir.activation.triggerKeyword).toBe('$cx-test');
  });

  it('parses AGENTS.md', () => {
    const f = writeFile(tmp(), 'AGENTS.md', '# Instructions\n\nDo good work.');
    const ir = parseAgentsMd(f);
    expect(ir.name).toBe('agents-instructions');
    expect(ir.activation.mode).toBe('always');
    expect(ir.body).toContain('good work');
  });
});

describe('OpenClaw Parser', () => {
  it('parses openclaw skill', () => {
    const dir = tmp();
    writeFile(dir, 'oc/SKILL.md', '---\nname: oc-test\ndescription: OpenClaw skill\n---\nContent');
    const ir = parseOpenClawSkill(path.join(dir, 'oc'));
    expect(ir.name).toBe('oc-test');
    expect(ir.sourceFormat).toBe('openclaw');
  });
});

describe('Copilot Parser', () => {
  it('parses root copilot-instructions.md', () => {
    const f = writeFile(tmp(), 'copilot-instructions.md', '# Copilot rules');
    const ir = parseCopilotInstructions(f);
    expect(ir.name).toBe('copilot-instructions');
    expect(ir.activation.mode).toBe('always');
  });

  it('parses scoped .instructions.md', () => {
    const f = writeFile(tmp(), 'testing.instructions.md', '---\ndescription: Testing\napplyTo: "**/*.test.ts"\n---\n\nUse vitest.');
    const ir = parseCopilotInstructions(f);
    expect(ir.name).toBe('testing');
    expect(ir.activation.mode).toBe('glob');
    expect(ir.activation.globs).toHaveLength(1);
  });
});

describe('Windsurf Parser', () => {
  it('parses .windsurfrules', () => {
    const f = writeFile(tmp(), '.windsurfrules', 'Be concise.\nNo fluff.');
    const ir = parseWindsurfRules(f);
    expect(ir.name).toBe('windsurf-rules');
    expect(ir.activation.mode).toBe('always');
    expect(ir.body).toContain('No fluff');
  });
});

describe('Real skills', () => {
  const tocPath = path.join(os.homedir(), '.claude', 'skills', 'toc');

  it.skipIf(!fs.existsSync(tocPath))('parses installed toc skill', () => {
    const ir = parseClaudeSkill(tocPath);
    expect(ir.name).toBe('toc');
    expect(ir.description.length).toBeGreaterThan(0);
    expect(ir.body.length).toBeGreaterThan(0);
    expect(ir.sourceFormat).toBe('claude');
  });
});

// ═══════════════════════════════════════════════════════════
// 5. EMITTERS
// ═══════════════════════════════════════════════════════════

describe('Claude Emitter', () => {
  it('emits complex skill with all features native', () => {
    const ir = buildComplexIR();
    const result = emitClaudeSkill(ir, tmp());
    expect(result.files.length).toBeGreaterThanOrEqual(3);
    const skillMd = result.files.find(f => f.path.endsWith('SKILL.md'))!;
    expect(skillMd.content).toContain('name: complex-skill');
    expect(skillMd.content).toContain('allowed-tools');
    expect(skillMd.content).toContain('context: fork');
    expect(result.warnings.filter(w => w.level === 'native').length).toBeGreaterThanOrEqual(3);
    expect(result.parity.score).toBeGreaterThanOrEqual(80);
    expect(result.files.some(f => f.path.includes('scripts/'))).toBe(true);
    expect(result.files.some(f => f.path.includes('references/'))).toBe(true);
  });

  it('emits CLAUDE.md for always-applied rules', () => {
    const ir: SkillIR = { name: 'rules', description: 'Rules', body: '# Rules', activation: { mode: 'always' }, sourceFormat: 'cursor', sourceFiles: [] };
    const result = emitClaudeMd(ir, tmp());
    expect(result.files[0].path).toMatch(/CLAUDE\.md$/);
  });

  it('emits scoped rules to .claude/rules/', () => {
    const ir: SkillIR = { name: 'scoped', description: 'Scoped', body: '# Scoped', activation: { mode: 'glob', globs: ['src/**/*.ts'] }, sourceFormat: 'cursor', sourceFiles: [] };
    const result = emitClaudeMd(ir, tmp());
    expect(result.files[0].path).toContain('.claude/rules/');
    expect(result.files[0].content).toContain('paths');
  });
});

describe('Cursor Emitter', () => {
  it('emits complex skill with shims and drops', () => {
    const ir = buildComplexIR();
    const result = emitCursorSkill(ir, tmp());
    const skillMd = result.files.find(f => f.path.endsWith('SKILL.md'))!;
    expect(skillMd.content).toContain('Tool restrictions');
    expect(skillMd.content).toContain('SKILLPORT');
    expect(result.warnings.some(w => w.level === 'shimmed')).toBe(true);
    expect(result.warnings.some(w => w.level === 'dropped')).toBe(true);
    expect(result.parity.score).toBeLessThan(100);
    expect(result.parity.score).toBeGreaterThan(30);
  });
});

describe('Codex Emitter', () => {
  it('emits with openai.yaml and hook wrapper scripts', () => {
    const ir = buildComplexIR();
    const result = emitCodexSkill(ir, tmp());
    expect(result.files.find(f => f.path.endsWith('SKILL.md'))).toBeDefined();
    const yaml = result.files.find(f => f.path.includes('openai.yaml'));
    expect(yaml).toBeDefined();
    expect(yaml!.content).toContain('Complex Skill');
    expect(result.files.some(f => f.path.includes('hook-'))).toBe(true);
    expect(result.warnings.some(w => w.level === 'dropped')).toBe(true);
  });

  it('emits AGENTS.md for rule-type', () => {
    const ir: SkillIR = { name: 'test', description: 'Test', body: '# Content', activation: { mode: 'always' }, sourceFormat: 'claude', sourceFiles: [] };
    expect(emitAgentsMd(ir, tmp()).files[0].path).toMatch(/AGENTS\.md$/);
  });

  it('annotates globs in AGENTS.md', () => {
    const ir: SkillIR = { name: 'test', description: 'Test', body: '# Content', activation: { mode: 'glob', globs: ['**/*.py'] }, sourceFormat: 'cursor', sourceFiles: [] };
    expect(emitAgentsMd(ir, tmp()).files[0].content).toContain('**/*.py');
  });
});

describe('OpenClaw Emitter', () => {
  it('drops hooks and subagent, shims dynamic context as preamble', () => {
    const ir = buildComplexIR();
    const result = emitOpenClawSkill(ir, tmp());
    const skillMd = result.files.find(f => f.path.endsWith('SKILL.md'))!;
    expect(skillMd.content).toContain('Tool restrictions');
    expect(skillMd.content).toContain('Preamble');
    expect(result.warnings.filter(w => w.level === 'dropped').length).toBeGreaterThanOrEqual(2);
    expect(result.parity.score).toBeLessThan(80);
  });
});

describe('Copilot Emitter', () => {
  it('emits scoped instruction with applyTo', () => {
    const ir = buildComplexIR();
    const result = emitCopilotInstructions(ir, tmp());
    expect(result.files[0].path).toContain('.github/instructions/');
    expect(result.files[0].content).toContain('applyTo');
    expect(result.warnings.filter(w => w.level === 'dropped').length).toBeGreaterThanOrEqual(3);
  });

  it('emits root file for always mode', () => {
    const ir: SkillIR = { name: 'base', description: 'Base', body: '# Rules', activation: { mode: 'always' }, sourceFormat: 'claude', sourceFiles: [] };
    expect(emitCopilotInstructions(ir, tmp()).files[0].path).toContain('copilot-instructions.md');
  });
});

describe('Windsurf Emitter', () => {
  it('drops most features with low parity', () => {
    const ir = buildComplexIR();
    const result = emitWindsurfRules(ir, tmp());
    expect(result.files[0].path).toContain('.windsurf/rules/');
    expect(result.files[0].content).toContain('Complex Skill');
    expect(result.warnings.filter(w => w.level === 'dropped').length).toBeGreaterThanOrEqual(3);
    expect(result.parity.score).toBeLessThan(60);
  });
});

describe('Simple skill emits at 100% parity', () => {
  const simpleIR: SkillIR = {
    name: 'simple', description: 'A simple skill', body: '# Simple\n\nDo things.',
    activation: { mode: 'intelligent' }, sourceFormat: 'claude', sourceFiles: [],
  };

  it.each(['claude', 'cursor', 'codex'] as const)('100%% parity for %s', (target) => {
    const out = tmp();
    const emit = target === 'claude' ? emitClaudeSkill : target === 'cursor' ? emitCursorSkill : emitCodexSkill;
    expect(emit(simpleIR, out).parity.score).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════
// 6. ROUND-TRIPS
// ═══════════════════════════════════════════════════════════

describe('Round-trip conversions', () => {
  it('CC → Cursor → CC preserves core fields', () => {
    const dir = tmp();
    writeFile(dir, 'original/SKILL.md', '---\nname: roundtrip-test\ndescription: Test skill for round-trip\nversion: 1.0.0\n---\n\n# Roundtrip Test\n\nBody content.\n\n## Section 2\n\nMore content.');

    const ir1 = parseClaudeSkill(path.join(dir, 'original'));
    const out1 = tmp();
    const cursorResult = emitCursorSkill(ir1, out1);
    for (const f of cursorResult.files) { fs.mkdirSync(path.dirname(f.path), { recursive: true }); fs.writeFileSync(f.path, f.content); }

    const cursorDir = path.dirname(cursorResult.files.find(f => f.path.endsWith('SKILL.md'))!.path);
    const ir2 = parseCursorSkill(cursorDir);
    expect(ir2.name).toBe('roundtrip-test');
    expect(ir2.description).toBe('Test skill for round-trip');

    const out2 = tmp();
    const final = emitClaudeSkill(ir2, out2);
    const finalMd = final.files.find(f => f.path.endsWith('SKILL.md'))!;
    expect(finalMd.content).toContain('roundtrip-test');
    expect(finalMd.content).toContain('Roundtrip');
    expect(finalMd.content).toContain('Section 2');
  });

  it('CC → Codex → CC preserves core fields', () => {
    const dir = tmp();
    writeFile(dir, 'original/SKILL.md', '---\nname: codex-rt\ndescription: Codex round-trip\n---\n\n# Content\n\nBody text.');

    const ir1 = parseClaudeSkill(path.join(dir, 'original'));
    const out1 = tmp();
    const codexResult = emitCodexSkill(ir1, out1);
    for (const f of codexResult.files) { fs.mkdirSync(path.dirname(f.path), { recursive: true }); fs.writeFileSync(f.path, f.content); }

    const codexDir = path.dirname(codexResult.files.find(f => f.path.endsWith('SKILL.md'))!.path);
    const ir2 = parseCodexSkill(codexDir);
    expect(ir2.name).toBe('codex-rt');
    expect(ir2.body).toContain('Body text');
  });

  it('Cursor → CC → Cursor preserves body and mode', () => {
    const f = writeFile(tmp(), 'style.mdc', '---\ndescription: Code style\nalwaysApply: true\n---\n\n# Style\n\nUse 2-space indentation.');
    const ir1 = parseCursorMdc(f);
    expect(ir1.activation.mode).toBe('always');

    const out1 = tmp();
    const ccResult = emitClaudeMd(ir1, out1);
    for (const file of ccResult.files) { fs.mkdirSync(path.dirname(file.path), { recursive: true }); fs.writeFileSync(file.path, file.content); }

    const ir2 = parseClaudeMd(ccResult.files[0].path);
    expect(ir2.body).toContain('2-space indentation');
    expect(ir2.activation.mode).toBe('always');
  });
});

// ═══════════════════════════════════════════════════════════
// 7. EDGE CASES
// ═══════════════════════════════════════════════════════════

describe('Edge Cases', () => {
  it('handles empty body skill', () => {
    const dir = tmp();
    writeFile(dir, 'empty/SKILL.md', '---\nname: empty\ndescription: Empty\n---\n');
    const ir = parseClaudeSkill(path.join(dir, 'empty'));
    expect(ir.body).toBe('');
    expect(emitCursorSkill(ir, tmp()).files.length).toBeGreaterThanOrEqual(1);
  });

  it('preserves special characters in name', () => {
    const dir = tmp();
    writeFile(dir, 'my-cool_skill.v2/SKILL.md', '---\nname: my-cool_skill.v2\n---\nContent');
    expect(parseClaudeSkill(path.join(dir, 'my-cool_skill.v2')).name).toBe('my-cool_skill.v2');
  });

  it('preserves very long description', () => {
    const longDesc = 'A'.repeat(5000);
    const dir = tmp();
    writeFile(dir, 'long/SKILL.md', `---\nname: long\ndescription: "${longDesc}"\n---\nContent`);
    expect(parseClaudeSkill(path.join(dir, 'long')).description).toHaveLength(5000);
  });

  it('handles code blocks containing ---', () => {
    const dir = tmp();
    writeFile(dir, 'cb/SKILL.md', '---\nname: codeblock\n---\n\n# Skill\n\n```yaml\n---\nkey: value\n---\n```\n\nMore content.');
    const ir = parseClaudeSkill(path.join(dir, 'cb'));
    expect(ir.name).toBe('codeblock');
    expect(ir.body).toContain('More content');
  });

  it('preserves unicode and emoji', () => {
    const dir = tmp();
    writeFile(dir, 'uni/SKILL.md', '---\nname: unicode-skill\ndescription: "Skill: 技术文档 🚀"\n---\n\n# 技术文档\n\nContent with 日本語 and 🎉');
    const ir = parseClaudeSkill(path.join(dir, 'uni'));
    expect(ir.description).toContain('技术文档');
    expect(ir.body).toContain('日本語');
    expect(ir.body).toContain('🎉');
    const result = emitCursorSkill(ir, tmp());
    expect(result.files.find(f => f.path.endsWith('SKILL.md'))!.content).toContain('技术文档');
  });

  it('converts to same format at 100% parity', () => {
    const dir = tmp();
    writeFile(dir, 'same/SKILL.md', '---\nname: same\ndescription: Same format\n---\nContent');
    const ir = parseClaudeSkill(path.join(dir, 'same'));
    const result = emitClaudeSkill(ir, tmp());
    expect(result.parity.score).toBe(100);
    expect(result.warnings.every(w => w.level === 'native')).toBe(true);
  });

  it('emits hooks correctly across all targets', () => {
    const ir: SkillIR = {
      name: 'hook-test', description: 'Hooks', body: '# Content',
      activation: { mode: 'intelligent' },
      hooks: [
        { event: 'PreToolUse', matcher: 'Bash', handler: { type: 'command', value: './check.sh' }, canBlock: true },
        { event: 'SessionStart', handler: { type: 'prompt', value: 'Init' }, canBlock: false },
      ],
      sourceFormat: 'claude', sourceFiles: [],
    };
    const out = tmp();

    const cursor = emitCursorSkill(ir, out);
    expect(cursor.warnings.some(w => w.level === 'shimmed')).toBe(true);
    expect(cursor.warnings.some(w => w.level === 'dropped')).toBe(true);

    const codex = emitCodexSkill(ir, out);
    expect(codex.warnings.some(w => w.level === 'dropped')).toBe(true);
    expect(codex.files.some(f => f.path.includes('hook-'))).toBe(true);

    const ws = emitWindsurfRules(ir, out);
    expect(ws.warnings.some(w => w.level === 'dropped')).toBe(true);
  });

  it('handles skill with no scripts/references dirs', () => {
    const dir = tmp();
    writeFile(dir, 'bare/SKILL.md', '---\nname: bare\n---\nContent');
    const ir = parseClaudeSkill(path.join(dir, 'bare'));
    expect(ir.scripts === undefined || ir.scripts?.length === 0).toBe(true);
    expect(ir.references === undefined || ir.references?.length === 0).toBe(true);
  });
});
