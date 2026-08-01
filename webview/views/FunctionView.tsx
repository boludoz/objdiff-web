import styles from './FunctionView.module.css';

import clsx from 'clsx';
import { type diff, display } from 'objdiff-wasm';
import { memo, useCallback, useMemo, useRef } from 'react';
import { FixedSizeList, areEqual } from 'react-window';
import type { ListChildComponentProps, ListOnScrollProps } from 'react-window';
import { useShallow } from 'zustand/react/shallow';
import {
  type AsmSpan,
  instructionRowToSpans,
  isDiffRow,
} from '../../shared/render/asm';
import { createContextMenu } from '../common/ContextMenu';
import { createTooltip } from '../common/TooltipShared';
import { buildDiffConfig, useAppStore, useExtensionStore } from '../state';
import {
  type HighlightState,
  highlightColumn,
  highlightMatches,
  updateHighlight,
} from '../util/highlight';
import { useFontSize } from '../util/util';

const ROTATION_CLASSES = [
  styles.rotation0,
  styles.rotation1,
  styles.rotation2,
  styles.rotation3,
  styles.rotation4,
  styles.rotation5,
  styles.rotation6,
  styles.rotation7,
  styles.rotation8,
];

const COLOR_CLASSES: Record<AsmSpan['color'], string | undefined> = {
  normal: undefined,
  dim: styles.segmentDim,
  bright: styles.segmentBright,
  replace: styles.segmentReplace,
  'data-flow': styles.segmentDataFlow,
  delete: styles.segmentDelete,
  insert: styles.segmentInsert,
  rotating: undefined,
};

const colorClass = (span: AsmSpan): string | undefined =>
  span.color === 'rotating'
    ? ROTATION_CLASSES[span.rotation ?? 0]
    : COLOR_CLASSES[span.color];

export type InstructionTooltipContent = {
  column: number;
  row: number;
};

export const {
  Tooltip: InstructionTooltip,
  useTooltip: useInstructionTooltip,
} = createTooltip<InstructionTooltipContent>();

export const {
  ContextMenuProvider: InstructionContextMenuProvider,
  useContextMenu: useInstructionContextMenu,
} = createContextMenu<InstructionTooltipContent>();

const AsmCell = ({
  obj,
  config,
  symbol,
  row,
  column,
  highlight: highlightState,
  setHighlight,
  listRef,
}: {
  obj: diff.ObjectDiff | undefined;
  config: diff.DiffConfig;
  symbol: display.SymbolRef | null;
  row: number;
  column: number;
  highlight: HighlightState;
  setHighlight: (highlight: HighlightState) => void;
  listRef: React.RefObject<FixedSizeList<ItemData>>;
}) => {
  const onContextMenu = useInstructionContextMenu();
  const tooltipContent: InstructionTooltipContent = useMemo(
    () => ({
      column,
      row,
    }),
    [column, row],
  );
  const tooltipProps = useInstructionTooltip(tooltipContent);
  const onContextMenuMemo = useCallback(
    (e: React.MouseEvent<HTMLElement>) => onContextMenu(e, tooltipContent),
    [onContextMenu, tooltipContent],
  );

  if (!obj || !symbol) {
    return null;
  }

  const highlight = highlightColumn(highlightState, column);

  const insRow = display.displayInstructionRow(obj, symbol, row, config);
  const out = instructionRowToSpans(insRow).map((span, index) => {
    const t = span.token;
    return (
      <span
        // biome-ignore lint/suspicious/noArrayIndexKey: spans are positional
        key={index}
        className={clsx(colorClass(span), {
          [styles.highlightable]: t != null,
          [styles.highlighted]: t != null && highlightMatches(highlight, t),
        })}
        onClick={(e) => {
          if (t == null) {
            return;
          }
          if (t.tag === 'branch-arrow') {
            listRef.current?.scrollToItem(t.val, 'center');
          } else {
            setHighlight(updateHighlight(highlightState, t, column));
            e.stopPropagation();
          }
        }}
      >
        {span.text}
      </span>
    );
  });

  const classes = [styles.instructionCell];
  if (isDiffRow(insRow.diffKind)) {
    classes.push(styles.diffAny);
  }
  if (!out.length) {
    return <div className={clsx(classes)} />;
  }

  return (
    <div
      className={clsx(classes)}
      onContextMenu={onContextMenuMemo}
      {...tooltipProps}
    >
      {out}
    </div>
  );
};

type ItemData = {
  itemCount: number;
  symbolName: string;
  result: diff.DiffResult;
  config: diff.DiffConfig;
  matchPercent?: number;
  leftSymbol: display.SymbolDisplay | null;
  rightSymbol: display.SymbolDisplay | null;
  highlight: HighlightState;
  setHighlight: (highlight: HighlightState) => void;
  listRef: React.RefObject<FixedSizeList<ItemData>>;
};

const AsmRow = memo(
  ({
    index,
    style,
    data: {
      result,
      config,
      leftSymbol,
      rightSymbol,
      highlight,
      setHighlight,
      listRef,
    },
  }: ListChildComponentProps<ItemData>) => {
    return (
      <div
        className={styles.instructionRow}
        style={style}
        onClick={() => {
          // Clear highlight on background click
          setHighlight({ left: null, right: null });
        }}
        onMouseDown={(e) => {
          // Prevent double click text selection
          if (e.detail > 1) {
            e.preventDefault();
          }
        }}
      >
        <AsmCell
          obj={result.left}
          config={config}
          symbol={leftSymbol?.info.id ?? null}
          row={index}
          column={0}
          highlight={highlight}
          setHighlight={setHighlight}
          listRef={listRef}
        />
        <AsmCell
          obj={result.right}
          config={config}
          symbol={rightSymbol?.info.id ?? null}
          row={index}
          column={1}
          highlight={highlight}
          setHighlight={setHighlight}
          listRef={listRef}
        />
      </div>
    );
  },
  areEqual,
);

export const InstructionList = ({
  height,
  width,
  diff,
  leftSymbol,
  rightSymbol,
}: {
  height: number;
  width: number;
  diff: diff.DiffResult;
  leftSymbol: display.SymbolDisplay | null;
  rightSymbol: display.SymbolDisplay | null;
}) => {
  const listRef = useRef<FixedSizeList<ItemData>>(null);
  const { configProperties, currentUnit } = useExtensionStore(
    useShallow((state) => ({
      configProperties: state.configProperties,
      currentUnit: state.currentUnit,
    })),
  );
  const { highlight, setSymbolScrollOffset, setHighlight } = useAppStore(
    useShallow((state) => ({
      highlight: state.highlight,
      setSymbolScrollOffset: state.setSymbolScrollOffset,
      setHighlight: state.setHighlight,
    })),
  );
  const itemData = useMemo(() => {
    const itemCount = Math.max(
      leftSymbol?.rowCount || 0,
      rightSymbol?.rowCount || 0,
    );
    const symbolName = leftSymbol?.info.name || rightSymbol?.info.name || '';
    const config = buildDiffConfig(configProperties);
    const matchPercent = leftSymbol?.matchPercent;
    return {
      itemCount,
      symbolName,
      result: diff,
      config,
      matchPercent,
      leftSymbol,
      rightSymbol,
      highlight,
      setHighlight,
      listRef,
    };
  }, [
    diff,
    leftSymbol,
    rightSymbol,
    configProperties,
    highlight,
    setHighlight,
  ]);
  const currentUnitName = currentUnit?.name || '';
  const initialScrollOffset = useMemo(
    () =>
      useAppStore.getState().getUnitState(currentUnitName).symbolScrollOffsets[
        itemData.symbolName
      ] || 0,
    [currentUnitName, itemData.symbolName],
  );
  const itemSize = useFontSize() * 1.33;
  const onScrollMemo = useCallback(
    (e: ListOnScrollProps) => {
      setSymbolScrollOffset(
        currentUnitName,
        itemData.symbolName,
        e.scrollOffset,
      );
    },
    [currentUnitName, itemData.symbolName, setSymbolScrollOffset],
  );
  return (
    <FixedSizeList
      ref={listRef}
      height={height}
      itemCount={itemData.itemCount}
      itemSize={itemSize}
      width={width}
      itemData={itemData}
      overscanCount={20}
      onScroll={onScrollMemo}
      initialScrollOffset={initialScrollOffset}
    >
      {AsmRow}
    </FixedSizeList>
  );
};
