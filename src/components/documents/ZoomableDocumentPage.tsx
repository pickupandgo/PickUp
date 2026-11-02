import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import { useDocumentPage } from '../../hooks/useDocumentPreview';
import type { PrivatePreview } from '../../services/documents/DocumentPreviewService';
import { colors } from '../../theme';

/** Pan/pinch operates on a rendered in-memory page, never a public file URL. */
export function ZoomableDocumentPage({ preview, page, width, height }: { preview: PrivatePreview; page: number; width: number; height: number }) {
  const image = useDocumentPage(preview, page, Math.round(width * 2));
  const zoom = useRef(1), position = useRef({ x: 0, y: 0 });
  const [zoomLabel, setZoomLabel] = useState(1);
  const scale = useRef(new Animated.Value(1)).current;
  const translation = useRef(new Animated.ValueXY()).current;
  const lastTap = useRef(0), startDistance = useRef(0), startScale = useRef(1);
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: event => event.nativeEvent.touches.length > 1 || zoom.current > 1,
    onMoveShouldSetPanResponder: event => event.nativeEvent.touches.length > 1 || zoom.current > 1,
    onPanResponderGrant: event => {
      startScale.current = zoom.current;
      const touches = event.nativeEvent.touches;
      startDistance.current = touches.length > 1 ? Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY) : 0;
    },
    onPanResponderMove: (event, gesture) => {
      const touches = event.nativeEvent.touches;
      if (touches.length > 1 && startDistance.current > 0) {
        zoom.current = Math.max(1, Math.min(4, startScale.current * Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY) / startDistance.current));
        scale.setValue(zoom.current);
      } else if (zoom.current > 1) {
        translation.setValue({ x: Math.max(-width * (zoom.current - 1) / 2, Math.min(width * (zoom.current - 1) / 2, position.current.x + gesture.dx)),
          y: Math.max(-height * (zoom.current - 1) / 2, Math.min(height * (zoom.current - 1) / 2, position.current.y + gesture.dy)) });
      }
    },
    onPanResponderRelease: (_event, gesture) => {
      setZoomLabel(Number(zoom.current.toFixed(1)));
      position.current = { x: Math.max(-width * (zoom.current - 1) / 2, Math.min(width * (zoom.current - 1) / 2, position.current.x + gesture.dx)),
        y: Math.max(-height * (zoom.current - 1) / 2, Math.min(height * (zoom.current - 1) / 2, position.current.y + gesture.dy)) };
      if (zoom.current <= 1) { position.current = { x: 0, y: 0 }; translation.setValue(position.current); }
    },
  }), [width, height, scale, translation]);
  return <View style={[styles.container, { width, height }]} {...pan.panHandlers}
    onTouchEnd={event => {
      if (event.nativeEvent.changedTouches.length !== 1) return;
      const now = Date.now();
      if (now - lastTap.current < 280) {
        zoom.current = zoom.current > 1 ? 1 : 2; scale.setValue(zoom.current);
        setZoomLabel(zoom.current);
        position.current = { x: 0, y: 0 }; translation.setValue(position.current);
      }
      lastTap.current = now;
    }}>
    {image.error ? <Text style={styles.error}>Page unavailable. Use Retry to reopen the document.</Text> : image.uri ?
      <Animated.Image source={{ uri: image.uri }} resizeMode="contain" accessibilityLabel={`Document page ${page + 1}, zoom ${zoomLabel}x`}
        style={{ width, height, transform: [{ translateX: translation.x }, { translateY: translation.y }, { scale }] }} /> : <ActivityIndicator accessibilityLabel="Loading document page" />}
  </View>;
}
const styles = StyleSheet.create({ container: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceContainerLowest }, error: { color: colors.error, padding: 16 } });
