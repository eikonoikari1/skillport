import type { ConversionWarning, FeatureParity, ParityAssessment } from '../ir.js';
import { computeParityLevel, computeParityScore } from '../ir.js';

export function buildParity(features: FeatureParity[], ir: { name: string }): ParityAssessment {
  const score = computeParityScore(features);
  const level = computeParityLevel(score);

  const dropped = features.filter((f) => f.status === 'dropped');
  const shimmed = features.filter((f) => f.status === 'shimmed');

  let verdict: string;
  if (level === 'full') {
    verdict = `The ported skill "${ir.name}" works identically in the target harness.`;
  } else if (level === 'high') {
    verdict = `The ported skill "${ir.name}" will work well for its core purpose.${shimmed.length ? ` ${shimmed.map((s) => s.feature).join(', ')} have functional approximations.` : ''}`;
  } else if (level === 'partial') {
    verdict = `Core behavior of "${ir.name}" is preserved but key features are approximated.${dropped.length ? ` ${dropped.map((d) => d.feature).join(', ')} have no equivalent and were annotated.` : ''}`;
  } else {
    verdict = `"${ir.name}" has significant functionality gaps. Manual adaptation recommended. ${dropped.map((d) => d.feature).join(', ')} are not available.`;
  }

  return { score, level, features, verdict };
}

export function formatReport(
  skillName: string,
  from: string,
  to: string,
  source: string,
  target: string,
  warnings: ConversionWarning[],
  parity: ParityAssessment
): string {
  const native = warnings.filter((w) => w.level === 'native');
  const shimmed = warnings.filter((w) => w.level === 'shimmed');
  const dropped = warnings.filter((w) => w.level === 'dropped');

  const lines: string[] = [];

  // Section 1: Summary
  lines.push(`skillport: ${skillName} (${from} → ${to})`);
  lines.push('');
  lines.push(`  Source:  ${source}`);
  lines.push(`  Target:  ${target}`);
  lines.push('');
  lines.push(`  Fields:  ${warnings.length} total`);
  if (native.length) lines.push(`    ✓  ${native.length} native   (${native.map((w) => w.field).join(', ')})`);
  if (shimmed.length) lines.push(`    ⚡  ${shimmed.length} shimmed  (${shimmed.map((w) => w.field).join(', ')})`);
  if (dropped.length) lines.push(`    ⚠  ${dropped.length} dropped  (${dropped.map((w) => w.field).join(', ')})`);
  lines.push('');

  // Section 2: Parity
  lines.push(`Parity: ${parity.score}% (${capitalize(parity.level)})`);
  lines.push('');
  lines.push('  Feature Coverage:');
  for (const f of parity.features) {
    const icon = f.status === 'native' ? '✓' : f.status === 'shimmed' ? '⚡' : '⚠';
    lines.push(`    ${icon} ${f.feature.padEnd(24)} ${String(f.percent).padStart(3)}%  ${f.notes}`);
  }
  lines.push('');
  lines.push(`  Verdict: ${parity.verdict}`);
  lines.push('');

  // Section 3: Tradeoffs
  const tradeoffs = warnings
    .filter((w) => w.level !== 'native')
    .map((w) => `• ${w.message}`);

  if (tradeoffs.length > 0) {
    lines.push('Key Points:');
    for (const t of tradeoffs) {
      lines.push(t);
    }
  }

  return lines.join('\n');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
