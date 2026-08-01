import styles from './DataView.module.css';

import clsx from 'clsx';
import { type diff, display } from 'objdiff-wasm';
import { memo, useCallback, useMemo } from 'react';
import { FixedSizeList, areEqual } from 'react-window';
import type { ListChildComponentProps, ListOnScrollProps } from 'react-window';
import { useShallow } from 'zustand/react/shallow';
import { type DataSpan, dataRowToSpans } from '../../shared/render/data';
import { createContextMenu } from '../common/ContextMenu';
import { createTooltip } from '../common/TooltipShared';
import { useAppStore, useExtensionStore } from '../state';
import { useFontSize } from '../util/util';

const KIND_CLASSES: Record<DataSpan['kind'], string | undefined> = {
  none: undefined,
  replace: styles.replace,
  delete: styles.delete,
  insert: styles.insert,
};

export type DataTooltipContent = {
  column: number;
  row: number;
};

export const { Tooltip: DataTooltip, useTooltip: useDataTooltip } =
  createTooltip<DataTooltipContent>();

export const {
  ContextMenuProvider: DataContextMenuProvider,
  useContextMenu: useDataContextMenu,
} = createContextMenu<DataTooltipContent>();

const DataCell = ({
  obj,
  symbol,
  row,
  column,
}: {
  obj: diff.ObjectDiff | undefined;
  symbol: display.SymbolDisplay | null;
  row: number;
  column: number;
}) => {
  const onContextMenu = useDataContextMenu();
  const tooltipContent: DataTooltipContent = useMemo(
    () => ({
      column,
      row,
    }),
    [column, row],
  );
  const tooltipProps = useDataTooltip(tooltipContent);
  const onContextMenuMemo = useCallback(
    (e: React.MouseEvent<HTMLElement>) => onContextMenu(e, tooltipContent),
    [onContextMenu, tooltipContent],
  );

  if (!obj || !symbol) {
    return null;
  }

  const { address, hex, ascii, anyDiff } = dataRowToSpans(
    display.displayDataRow(obj, symbol.info.id, row),
  );

  const renderSpans = (spans: DataSpan[], prefix: string) =>
    spans.map((span, index) => (
      <span
        // biome-ignore lint/suspicious/noArrayIndexKey: spans are positional
        key={`${prefix}-${index}`}
        className={KIND_CLASSES[span.kind]}
      >
        {span.text}
      </span>
    ));

  return (
    <div
      className={clsx(styles.dataCell, anyDiff && styles.diffAny)}
      onContextMenu={onContextMenuMemo}
      {...tooltipProps}
    >
      <span className={styles.address}>{address}</span>
      <span>{renderSpans(hex, 'hex')}</span>
      <span> </span>
      <span>{renderSpans(ascii, 'ascii')}</span>
    </div>
  );
};

const DataRow = memo(
  ({
    index,
    style,
    data,
  }: ListChildComponentProps<{
    leftObj: diff.ObjectDiff | undefined;
    leftSymbol: display.SymbolDisplay | null;
    rightObj: diff.ObjectDiff | undefined;
    rightSymbol: display.SymbolDisplay | null;
  }>) => {
    const { leftObj, leftSymbol, rightObj, rightSymbol } = data;
    return (
      <div style={style} className={styles.dataRow}>
        <DataCell obj={leftObj} symbol={leftSymbol} row={index} column={0} />
        <DataCell obj={rightObj} symbol={rightSymbol} row={index} column={1} />
      </div>
    );
  },
  areEqual,
);

export const DataList = ({
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
  const { currentUnit } = useExtensionStore(
    useShallow((state) => ({
      currentUnit: state.currentUnit,
    })),
  );
  const { setSymbolScrollOffset } = useAppStore(
    useShallow((state) => ({
      setSymbolScrollOffset: state.setSymbolScrollOffset,
    })),
  );
  const fontSize = useFontSize();

  const leftCount = leftSymbol?.rowCount ?? 0;
  const rightCount = rightSymbol?.rowCount ?? 0;
  const rowCount = Math.max(leftCount, rightCount);

  // Get symbol name for scroll persistence
  const symbolName = useMemo(() => {
    if (leftSymbol && diff.left) {
      return leftSymbol.info.name;
    }
    if (rightSymbol && diff.right) {
      return rightSymbol.info.name;
    }
    return '';
  }, [diff, leftSymbol, rightSymbol]);

  const itemData = useMemo(
    () => ({
      leftObj: diff.left,
      leftSymbol,
      rightObj: diff.right,
      rightSymbol,
    }),
    [diff, leftSymbol, rightSymbol],
  );

  const currentUnitName = currentUnit?.name || '';

  // Get initial scroll offset
  const initialScrollOffset = useMemo(
    () =>
      useAppStore.getState().getUnitState(currentUnitName).symbolScrollOffsets[
        symbolName
      ] || 0,
    [currentUnitName, symbolName],
  );

  // Handle scroll events to persist position
  const onScrollMemo = useCallback(
    (e: ListOnScrollProps) => {
      setSymbolScrollOffset(currentUnitName, symbolName, e.scrollOffset);
    },
    [currentUnitName, symbolName, setSymbolScrollOffset],
  );

  if ((!diff.left || !leftSymbol) && (!diff.right || !rightSymbol)) {
    return null;
  }

  return (
    <FixedSizeList
      height={height}
      width={width}
      itemCount={rowCount}
      itemSize={fontSize * 1.5}
      itemData={itemData}
      onScroll={onScrollMemo}
      initialScrollOffset={initialScrollOffset}
    >
      {DataRow}
    </FixedSizeList>
  );
};

export default DataList;
