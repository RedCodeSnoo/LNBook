/**
 * Minimal cache invalidation: screens read the database synchronously with `useQuery`
 * and are refreshed when a mutation calls `invalidate` with one of their keys.
 */
import { useMemo } from 'react';
import { create } from 'zustand';

export type DataKey =
  | 'library'
  | 'categories'
  | 'novel'
  | 'chapters'
  | 'history'
  | 'quotes'
  | 'plugins'
  | 'downloads'
  | 'updates'
  | 'stats'
  | 'replacements'
  /** Text of chapters as displayed: edits and replacement rules. */
  | 'chapterContent'
  | 'glossary';

type Versions = Record<DataKey, number>;

const useVersions = create<Versions>(() => ({
  library: 0,
  categories: 0,
  novel: 0,
  chapters: 0,
  history: 0,
  quotes: 0,
  plugins: 0,
  downloads: 0,
  updates: 0,
  stats: 0,
  replacements: 0,
  chapterContent: 0,
  glossary: 0,
}));

export function invalidate(...keys: DataKey[]): void {
  useVersions.setState((state) => {
    const next = { ...state };
    for (const key of keys) {
      next[key] += 1;
    }
    return next;
  });
}

/**
 * Runs a synchronous query again whenever its data keys or dependencies change.
 * Dependencies must be primitive values (ids, strings, booleans).
 */
export function useQuery<T>(
  query: () => T,
  keys: DataKey[],
  deps: (string | number | boolean | null | undefined)[] = [],
): T {
  const stamp = useVersions((state) => keys.map((key) => state[key]).join('.'));
  const depsKey = deps.map((dep) => `${typeof dep}:${String(dep)}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => query(), [stamp, depsKey]);
}

/** Changes every time one of the keys is invalidated (to redo work that is not a query). */
export function useDataVersion(...keys: DataKey[]): string {
  return useVersions((state) => keys.map((key) => state[key]).join('.'));
}
