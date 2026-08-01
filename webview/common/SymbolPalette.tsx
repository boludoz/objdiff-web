import styles from './SymbolPalette.module.css';

import clsx from 'clsx';
import { type diff, display } from 'objdiff-wasm';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { type MatchRange, fuzzyMatchSymbol } from '../../shared/fuzzy';
import type { DiffOutput } from '../diff';
import { type SymbolRefByName, useAppStore, useExtensionStore } from '../state';
import { splitRanges } from '../util/symbolSearch';
import PercentBadge from './PercentBadge';

const MAX_RESULTS = 200;

type Entry = {
  side: 'left' | 'right';
  name: string;
  displayName: string;
  sectionName: string;
  matchPercent: number | null;
  targetName: string | null;
};

type Ranked = Entry & { ranges: MatchRange[]; score: number };

const collectEntries = (
  obj: diff.ObjectDiff | undefined,
  otherObj: diff.ObjectDiff | undefined,
  side: 'left' | 'right',
): Entry[] => {
  if (!obj) {
    return [];
  }
  const entries: Entry[] = [];
  const sections = display.displaySections(
    obj,
    {},
    {
      showHiddenSymbols: false,
      showMappedSymbols: true,
      reverseFnOrder: false,
    },
  );
  for (const section of sections) {
    for (const ref of section.symbols) {
      const symbol = display.displaySymbol(obj, ref);
      let targetName: string | null = null;
      if (symbol.targetSymbol !== undefined && otherObj) {
        targetName = otherObj.getSymbol(symbol.targetSymbol)?.name ?? null;
      }
      entries.push({
        side,
        name: symbol.info.name,
        displayName: symbol.info.demangledName || symbol.info.name,
        sectionName: section.name,
        matchPercent: symbol.matchPercent ?? null,
        targetName,
      });
    }
  }
  return entries;
};

/**
 * Command-palette style "go to symbol", opened with Ctrl+P or Ctrl+Shift+O.
 *
 * Searches both sides at once so you can jump straight to a function without
 * first working out which column it lives in.
 */
export const SymbolPalette = ({
  result,
  onClose,
}: {
  result: DiffOutput;
  onClose: () => void;
}) => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const setSelectedSymbol = useAppStore((state) => state.setSelectedSymbol);

  const entries = useMemo(() => {
    const left = collectEntries(result.diff?.left, result.diff?.right, 'left');
    // Only include base symbols that have no target counterpart, so matched
    // functions don't appear twice.
    const leftTargets = new Set(
      left.map((e) => e.targetName).filter((n): n is string => n != null),
    );
    const right = collectEntries(
      result.diff?.right,
      result.diff?.left,
      'right',
    ).filter((e) => !leftTargets.has(e.name));
    return [...left, ...right];
  }, [result.diff]);

  const ranked = useMemo<Ranked[]>(() => {
    if (!query) {
      return entries
        .slice()
        .sort((a, b) => (a.matchPercent ?? 101) - (b.matchPercent ?? 101))
        .slice(0, MAX_RESULTS)
        .map((entry) => ({ ...entry, ranges: [], score: 0 }));
    }
    const out: Ranked[] = [];
    for (const entry of entries) {
      const match = fuzzyMatchSymbol(
        query,
        entry.name,
        entry.displayName === entry.name ? undefined : entry.displayName,
      );
      if (match) {
        out.push({ ...entry, ranges: match.ranges, score: match.score });
      }
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, MAX_RESULTS);
  }, [entries, query]);

  // Reset the highlight whenever the result set changes under it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ranked is the signal
  useEffect(() => setSelected(0), [ranked]);

  // Keep the highlighted row in view as the selection moves.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const choose = useCallback(
    (entry: Ranked | undefined) => {
      if (!entry) {
        return;
      }
      const self: SymbolRefByName = {
        symbolName: entry.name,
        sectionName: entry.sectionName,
      };
      const other: SymbolRefByName | null = entry.targetName
        ? { symbolName: entry.targetName, sectionName: entry.sectionName }
        : null;
      if (entry.side === 'left') {
        setSelectedSymbol(self, other);
      } else {
        setSelectedSymbol(other, self);
      }
      onClose();
    },
    [setSelectedSymbol, onClose],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelected((i) => (ranked.length ? (i + 1) % ranked.length : 0));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelected((i) =>
            ranked.length ? (i - 1 + ranked.length) % ranked.length : 0,
          );
          break;
        case 'Home':
          e.preventDefault();
          setSelected(0);
          break;
        case 'End':
          e.preventDefault();
          setSelected(Math.max(0, ranked.length - 1));
          break;
        case 'Enter':
          e.preventDefault();
          choose(ranked[selected]);
          break;
      }
    },
    [ranked, selected, choose, onClose],
  );

  return (
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className={styles.palette} onKeyDown={onKeyDown}>
        <div className={styles.header}>
          <input
            autoFocus
            type="text"
            placeholder="Go to symbol…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <div className={styles.meta}>
            <span>
              {ranked.length}
              {ranked.length === MAX_RESULTS ? '+' : ''} of {entries.length}
            </span>
            <span className={styles.spacer} />
            <span>
              <kbd>↑</kbd> <kbd>↓</kbd> navigate · <kbd>Enter</kbd> open ·{' '}
              <kbd>Esc</kbd> close
            </span>
          </div>
        </div>
        <div className={styles.list} ref={listRef}>
          {ranked.length === 0 ? (
            <div className={styles.empty}>
              {entries.length === 0
                ? 'No symbols in this object'
                : `No symbol matches "${query}"`}
            </div>
          ) : (
            ranked.map((entry, index) => (
              <div
                key={`${entry.side}-${entry.sectionName}-${entry.name}`}
                data-index={index}
                className={clsx(
                  styles.row,
                  index === selected && styles.selected,
                )}
                onMouseMove={() => setSelected(index)}
                onClick={() => choose(entry)}
                onKeyDown={undefined}
              >
                <span className={styles.side}>
                  {entry.side === 'left' ? 'target' : 'base'}
                </span>
                <span className={styles.name}>
                  {splitRanges(entry.displayName, entry.ranges).map(
                    (part, i) => (
                      <span
                        // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional
                        key={i}
                        className={part.matched ? styles.matched : undefined}
                      >
                        {part.text}
                      </span>
                    ),
                  )}
                </span>
                <span className={styles.section}>{entry.sectionName}</span>
                {entry.matchPercent != null && (
                  <span className={styles.percent}>
                    <PercentBadge percent={entry.matchPercent} />
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

/** Wires up Ctrl+P / Ctrl+Shift+O and renders the palette when open. */
export const useSymbolPalette = (result: DiffOutput) => {
  const [open, setOpen] = useState(false);
  const ready = useExtensionStore(useShallow((state) => state.ready));

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) {
        return;
      }
      if (e.key === 'p' || (e.shiftKey && (e.key === 'O' || e.key === 'o'))) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  return {
    palette:
      open && ready && result.diff ? (
        <SymbolPalette result={result} onClose={close} />
      ) : null,
    openPalette: useCallback(() => setOpen(true), []),
  };
};

export default SymbolPalette;
