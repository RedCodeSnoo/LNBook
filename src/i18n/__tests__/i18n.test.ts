import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import en from '../en.json';
import fr from '../fr.json';
import { resolveLanguage } from '../index';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : flatten(value, `${prefix}${key}.`),
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === '__tests__' ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('translations', () => {
  const frKeys = flatten(fr).sort();
  const enKeys = flatten(en).sort();

  it('have the same keys in French and English', () => {
    expect(enKeys).toEqual(frKeys);
  });

  it('have no empty text', () => {
    for (const tree of [fr, en]) {
      const walk = (node: Tree) => {
        for (const value of Object.values(node)) {
          if (typeof value === 'string') {
            expect(value.trim()).not.toBe('');
          } else {
            walk(value);
          }
        }
      };
      walk(tree);
    }
  });

  it('define every key used with a literal in the code', () => {
    const known = new Set(frKeys);
    // Plural keys are declared as key_one / key_other.
    const exists = (key: string) =>
      known.has(key) || (known.has(`${key}_one`) && known.has(`${key}_other`));
    const missing: string[] = [];
    for (const file of sourceFiles(join(__dirname, '..', '..'))) {
      const code = readFileSync(file, 'utf8');
      for (const match of code.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'/g)) {
        if (!exists(match[1])) {
          missing.push(`${match[1]} (${file})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('resolveLanguage', () => {
  it('uses the explicit setting', () => {
    expect(resolveLanguage('en', ['fr-FR'])).toBe('en');
  });

  it('follows the phone language when supported', () => {
    expect(resolveLanguage('system', ['en-GB', 'fr-FR'])).toBe('en');
    expect(resolveLanguage('system', ['de-DE', 'fr-CA'])).toBe('fr');
  });

  it('falls back to French', () => {
    expect(resolveLanguage('system', ['de-DE', 'ja-JP'])).toBe('fr');
    expect(resolveLanguage('system', [])).toBe('fr');
  });
});
