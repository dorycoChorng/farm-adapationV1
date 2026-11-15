import { forwardRef, type ReactNode, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { colors, radius, shadow, spacing } from '../theme/colors';
import { tapFeedback } from './ui';

export interface BottomSheetHandle {
  snapTo(index: 0 | 1): void;
}

/**
 * A sheet that rests over the bottom of the map. Drag (or tap) the handle to switch
 * between a short "peek" height and a tall expanded height.
 */
export const BottomSheet = forwardRef<
  BottomSheetHandle,
  {
    peekHeight: number;
    expandedHeight: number;
    children: ReactNode;
    header?: ReactNode;
    bottomInset?: number;
    onSnap?: (index: 0 | 1) => void;
    testID?: string;
  }
>(function BottomSheet({ peekHeight, expandedHeight, children, header, bottomInset = 0, onSnap, testID }, ref) {
  const travel = Math.max(0, expandedHeight - peekHeight);
  const y = useRef(new Animated.Value(travel)).current;
  const at = useRef(travel);
  const [index, setIndex] = useState<0 | 1>(0);

  const snapTo = (i: 0 | 1) => {
    const target = i === 1 ? 0 : travel;
    at.current = target;
    setIndex(i);
    onSnap?.(i);
    Animated.spring(y, { toValue: target, useNativeDriver: Platform.OS !== 'web', bounciness: 4, speed: 14 }).start();
  };
  useImperativeHandle(ref, () => ({ snapTo }));

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_e, g) => y.setValue(Math.min(travel, Math.max(0, at.current + g.dy))),
        onPanResponderRelease: (_e, g) => {
          const pos = Math.min(travel, Math.max(0, at.current + g.dy));
          const open = g.vy < -0.4 ? true : g.vy > 0.4 ? false : pos < travel / 2;
          tapFeedback('select');
          snapTo(open ? 1 : 0);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [travel],
  );

  return (
    <Animated.View
      testID={testID}
      style={[s.sheet, { height: expandedHeight + bottomInset, transform: [{ translateY: y }] }]}
      pointerEvents="box-none"
    >
      <View {...pan.panHandlers}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={index === 1 ? 'Collapse panel' : 'Expand panel'}
          accessibilityState={{ expanded: index === 1 }}
          onPress={() => snapTo(index === 1 ? 0 : 1)}
          style={s.handleZone}
          testID="sheet-handle"
        >
          <View style={s.handle} />
        </Pressable>
        {header}
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.content, { paddingBottom: bottomInset + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </Animated.View>
  );
});

const s = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    ...shadow.float,
  },
  handleZone: { alignItems: 'center', justifyContent: 'center', height: 26 },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: '#c5d1c9' },
  content: { paddingHorizontal: spacing.lg, gap: spacing.sm },
});
