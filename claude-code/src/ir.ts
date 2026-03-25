import { z } from 'zod';

export const HarnessTypes = ['claude', 'cursor', 'codex', 'openclaw', 'copilot', 'windsurf'] as const;
export type HarnessType = (typeof HarnessTypes)[number];

export const HarnessTypeSchema = z.enum(HarnessTypes);

export const ActivationModeSchema = z.enum(['always', 'intelligent', 'glob', 'manual', 'explicit']);
export type ActivationMode = z.infer<typeof ActivationModeSchema>;

export interface FileEntry {
  path: string;
  content: string;
}

export interface HookIR {
  event: string;
  matcher?: string;
  handler: {
    type: 'command' | 'prompt' | 'agent' | 'http';
    value: string;
    timeout?: number;
  };
  canBlock: boolean;
}

export interface DynamicContextIR {
  placeholder: string;
  command: string;
}

export interface SkillIR {
  name: string;
  description: string;
  version?: string;
  body: string;

  activation: {
    mode: ActivationMode;
    globs?: string[];
    triggerKeyword?: string;
  };

  allowedTools?: string[];
  deniedTools?: string[];

  hooks?: HookIR[];

  subagent?: {
    enabled: boolean;
    agentType?: string;
    isolation?: 'fork' | 'worktree';
  };

  dynamicContext?: DynamicContextIR[];

  model?: string;
  effort?: string;

  scripts?: FileEntry[];
  references?: FileEntry[];

  harnessSpecific?: {
    claude?: {
      disableModelInvocation?: boolean;
      userInvocable?: boolean;
    };
    cursor?: {
      alwaysApply?: boolean;
    };
    codex?: {
      allowImplicitInvocation?: boolean;
      displayName?: string;
      iconSmall?: string;
      iconLarge?: string;
      brandColor?: string;
    };
    openclaw?: {
      channels?: string[];
    };
    copilot?: {
      excludeAgent?: string;
    };
  };

  sourceFormat: HarnessType;
  sourceFiles: string[];
}

export interface ConversionResult {
  files: { path: string; content: string }[];
  warnings: ConversionWarning[];
  parity: ParityAssessment;
}

export interface ConversionWarning {
  field: string;
  level: 'native' | 'shimmed' | 'dropped';
  message: string;
  shim?: string; // path to generated shim file
}

export interface ParityAssessment {
  score: number; // 0-100
  level: 'full' | 'high' | 'partial' | 'low';
  features: FeatureParity[];
  verdict: string;
}

export interface FeatureParity {
  feature: string;
  status: 'native' | 'shimmed' | 'dropped';
  percent: number;
  notes: string;
}

export function computeParityLevel(score: number): ParityAssessment['level'] {
  if (score >= 95) return 'full';
  if (score >= 80) return 'high';
  if (score >= 50) return 'partial';
  return 'low';
}

export function computeParityScore(features: FeatureParity[]): number {
  if (features.length === 0) return 100;
  const total = features.reduce((sum, f) => sum + f.percent, 0);
  return Math.round(total / features.length);
}
