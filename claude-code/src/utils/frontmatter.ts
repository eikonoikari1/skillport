import YAML from 'yaml';

export interface ParsedDoc {
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * Parse a markdown document with optional YAML frontmatter.
 * Handles both standard SKILL.md and Cursor .mdc formats.
 */
export function parseFrontmatter(content: string): ParsedDoc {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: content.trim() };
  }

  const endIndex = trimmed.indexOf('---', 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: content.trim() };
  }

  const yamlBlock = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 3).trim();

  try {
    // Pre-process for .mdc quirks: unquoted glob values with asterisks
    const sanitized = sanitizeMdcYaml(yamlBlock);
    const frontmatter = YAML.parse(sanitized) || {};
    return { frontmatter, body };
  } catch {
    return { frontmatter: {}, body: content.trim() };
  }
}

/**
 * Serialize frontmatter + body back to markdown document.
 */
export function serializeFrontmatter(
  frontmatter: Record<string, unknown>,
  body: string,
  options?: { mdcMode?: boolean }
): string {
  const keys = Object.keys(frontmatter).filter(
    (k) => frontmatter[k] !== undefined && frontmatter[k] !== null
  );

  if (keys.length === 0) {
    return body;
  }

  const filtered: Record<string, unknown> = {};
  for (const k of keys) {
    filtered[k] = frontmatter[k];
  }

  let yamlStr: string;
  if (options?.mdcMode) {
    yamlStr = serializeMdcYaml(filtered);
  } else {
    yamlStr = YAML.stringify(filtered, { lineWidth: 0 }).trim();
  }

  return `---\n${yamlStr}\n---\n\n${body}`;
}

/**
 * Sanitize .mdc YAML: wrap unquoted glob values containing * in quotes.
 */
function sanitizeMdcYaml(yaml: string): string {
  return yaml.replace(
    /^(\s*(?:globs|applyTo)\s*:\s*)(.+)$/gm,
    (_, prefix: string, value: string) => {
      const trimVal = value.trim();
      // Already a proper YAML array
      if (trimVal.startsWith('[')) {
        return `${prefix}${value}`;
      }
      // Comma-separated values (quoted or unquoted) — wrap in array brackets
      const parts = trimVal.split(',').map((p: string) => {
        const t = p.trim();
        if (t.startsWith('"') || t.startsWith("'")) return t;
        return `"${t}"`;
      });
      if (parts.length > 1 || !trimVal.startsWith('"')) {
        return `${prefix}[${parts.join(', ')}]`;
      }
      // Single quoted value — wrap in array
      return `${prefix}[${trimVal}]`;
    }
  );
}

/**
 * Serialize YAML for Cursor .mdc format (unquoted glob values).
 */
function serializeMdcYaml(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;

    if (key === 'globs' && Array.isArray(value)) {
      // .mdc uses unquoted glob values
      lines.push(`globs: ${value.join(', ')}`);
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === 'string') {
      if (value.includes('\n')) {
        lines.push(`${key}: |`);
        for (const line of value.split('\n')) {
          lines.push(`  ${line}`);
        }
      } else {
        lines.push(`${key}: ${value}`);
      }
    } else if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
    } else {
      lines.push(`${key}: ${YAML.stringify(value).trim()}`);
    }
  }
  return lines.join('\n');
}
