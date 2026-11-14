/**
 * Text replacement rules (global or per novel) applied when a chapter is displayed
 * or read aloud, to remove ads and parasite sentences added by the sites.
 */
import { escapeHtml } from '../../services/html';

export interface ReplacementRule {
  pattern: string;
  replacement: string;
  isRegex: boolean;
  enabled?: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Compiles a rule; returns null when the regular expression is invalid or empty. */
export function compileRule(rule: ReplacementRule): RegExp | null {
  if (rule.pattern === '') {
    return null;
  }
  try {
    return new RegExp(rule.isRegex ? rule.pattern : escapeRegExp(rule.pattern), 'gu');
  } catch {
    try {
      return new RegExp(rule.isRegex ? rule.pattern : escapeRegExp(rule.pattern), 'g');
    } catch {
      return null;
    }
  }
}

export function isValidRule(rule: ReplacementRule): boolean {
  return compileRule(rule) !== null;
}

interface CompiledRule {
  expression: RegExp;
  replacement: string;
}

function compileAll(rules: ReplacementRule[]): CompiledRule[] {
  return rules
    .filter((rule) => rule.enabled !== false)
    .flatMap((rule) => {
      const expression = compileRule(rule);
      // In plain text mode "$1" must stay literal.
      const replacement = rule.isRegex ? rule.replacement : rule.replacement.replace(/\$/g, '$$$$');
      return expression ? [{ expression, replacement }] : [];
    });
}

/** Applies the rules to plain text. */
export function applyRulesToText(text: string, rules: ReplacementRule[]): string {
  return compileAll(rules).reduce(
    (result, rule) => result.replace(rule.expression, rule.replacement),
    text,
  );
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' };

/**
 * Applies the rules to the text of an HTML fragment, leaving tags untouched.
 * Paragraphs that become empty are removed.
 */
export function applyRulesToHtml(html: string, rules: ReplacementRule[]): string {
  const compiled = compileAll(rules);
  if (compiled.length === 0) {
    return html;
  }
  const replaced = html.replace(/(^|>)([^<]+)(?=<|$)/g, (_match, open: string, text: string) => {
    const decoded = text.replace(/&(?:amp|lt|gt|quot);/g, (entity) => ENTITIES[entity]);
    const result = compiled.reduce(
      (value, rule) => value.replace(rule.expression, rule.replacement),
      decoded,
    );
    return open + (result === decoded ? text : escapeHtml(result));
  });
  return replaced.replace(/<(p|div|h[1-6]|li|blockquote)>(?:\s|&nbsp;)*<\/\1>\n?/g, '');
}
