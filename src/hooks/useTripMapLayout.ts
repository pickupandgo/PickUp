import { useCallback, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
export function useTripMapLayout() {
  const [top, setTop] = useState(0),
    [bottom, setBottom] = useState(0);
  const onTopLayout = useCallback(
    (event: LayoutChangeEvent) =>
      setTop(Math.ceil(event.nativeEvent.layout.height)),
    [],
  );
  const onSheetHeight = useCallback(
    (height: number) => setBottom(Math.ceil(height)),
    [],
  );
  return { onTopLayout, onSheetHeight, viewportPadding: { top, bottom } };
}
