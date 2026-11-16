import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { type ComponentProps, type ReactNode, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  LayoutAnimation,
  Platform,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';

import { colors, radius, shadow, spacing, TOUCH_TARGET, type } from '../../theme/colors';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export { Ionicons };

const nativeDriver = Platform.OS !== 'web';
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** A light tap on the phone's vibration motor; silently skipped where unsupported. */
export function tapFeedback(kind: 'light' | 'select' | 'success' | 'warning' = 'light') {
  if (Platform.OS === 'web') return;
  const p =
    kind === 'select'
      ? Haptics.selectionAsync()
      : kind === 'success'
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        : kind === 'warning'
          ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
          : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  p.catch(() => undefined);
}

/** Pressable that shrinks slightly while pressed, so every tap feels acknowledged. */
export function PressableScale({
  style,
  children,
  onPressIn,
  onPressOut,
  onPress,
  scaleTo = 0.96,
  haptic = true,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & { style?: ViewStyle | (ViewStyle | false | null | undefined)[]; children: ReactNode; scaleTo?: number; haptic?: boolean }) {
  const scale = useState(() => new Animated.Value(1))[0];
  const to = (v: number) => Animated.spring(scale, { toValue: v, useNativeDriver: nativeDriver, speed: 40, bounciness: 6 }).start();
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        to(scaleTo);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(1);
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic) tapFeedback();
        onPress?.(e);
      }}
      style={[StyleSheet.flatten(style), { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}

type Variant = 'primary' | 'secondary' | 'outline' | 'danger' | 'soft' | 'ghost';

const VARIANTS: Record<Variant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.primary, fg: colors.white, border: colors.primary },
  secondary: { bg: colors.secondary, fg: colors.white, border: colors.secondary },
  outline: { bg: colors.surface, fg: colors.primaryDark, border: colors.primarySoft },
  danger: { bg: colors.surface, fg: colors.danger, border: '#f1c3bf' },
  soft: { bg: colors.primaryLight, fg: colors.primaryDark, border: colors.primaryLight },
  ghost: { bg: 'transparent', fg: colors.primaryDark, border: 'transparent' },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  busy,
  style,
  testID,
  grow = true,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
  testID?: string;
  grow?: boolean;
}) {
  const v = VARIANTS[variant];
  const off = disabled || busy;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      testID={testID}
      onPress={onPress}
      disabled={off}
      style={[styles.button, { backgroundColor: v.bg, borderColor: v.border }, grow && styles.grow, off && styles.disabled, style]}
    >
      {busy ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <View style={styles.buttonInner}>
          {icon ? <Ionicons name={icon} size={17} color={v.fg} /> : null}
          <Text style={[styles.buttonText, { color: v.fg }]}>{label}</Text>
        </View>
      )}
    </PressableScale>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  tone = 'surface',
  size = TOUCH_TARGET,
  testID,
  style,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  tone?: 'surface' | 'primary' | 'secondary' | 'glass';
  size?: number;
  testID?: string;
  style?: ViewStyle;
}) {
  const palette =
    tone === 'primary'
      ? { bg: colors.primary, fg: colors.white }
      : tone === 'secondary'
        ? { bg: colors.secondary, fg: colors.white }
        : tone === 'glass'
          ? { bg: 'rgba(255,255,255,0.18)', fg: colors.white }
          : { bg: colors.surface, fg: colors.primaryDark };
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      scaleTo={0.9}
      style={[styles.iconButton, { width: size, height: size, borderRadius: size / 2, backgroundColor: palette.bg }, tone !== 'glass' && shadow.float, style]}
    >
      <Ionicons name={icon} size={Math.round(size * 0.46)} color={palette.fg} />
    </PressableScale>
  );
}

export function Banner({ kind, children, icon }: { kind: 'info' | 'warning' | 'error' | 'success'; children: ReactNode; icon?: IconName }) {
  const palette =
    kind === 'error'
      ? { bg: colors.dangerBg, fg: colors.danger, icon: 'alert-circle' as const }
      : kind === 'warning'
        ? { bg: colors.warningBg, fg: colors.warning, icon: 'warning' as const }
        : kind === 'success'
          ? { bg: colors.primaryLight, fg: colors.primaryDark, icon: 'checkmark-circle' as const }
          : { bg: colors.infoBg, fg: colors.secondary, icon: 'information-circle' as const };
  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: palette.bg }]}>
      <Ionicons name={icon ?? palette.icon} size={20} color={palette.fg} style={{ marginTop: 1 }} />
      <Text style={[styles.bannerText, { color: palette.fg }]}>{children}</Text>
    </View>
  );
}

export function Card({
  title,
  icon,
  iconColor = colors.primary,
  iconBg = colors.primaryLight,
  right,
  children,
  style,
  testID,
}: {
  title?: string;
  icon?: IconName;
  iconColor?: string;
  iconBg?: string;
  right?: ReactNode;
  children: ReactNode;
  style?: ViewStyle;
  testID?: string;
}) {
  return (
    <View style={[styles.card, style]} testID={testID}>
      {title ? (
        <View style={styles.cardHeader}>
          {icon ? (
            <View style={[styles.cardIcon, { backgroundColor: iconBg }]}>
              <Ionicons name={icon} size={15} color={iconColor} />
            </View>
          ) : null}
          <Text style={styles.cardTitle} accessibilityRole="header">
            {title}
          </Text>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function InfoRow({ label, value, icon }: { label: string; value: string; icon?: IconName }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoLabelWrap}>
        {icon ? <Ionicons name={icon} size={16} color={colors.textFaint} /> : null}
        <Text style={styles.infoLabel}>{label}</Text>
      </View>
      <Text style={styles.infoValue} selectable>
        {value}
      </Text>
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Chip({
  label,
  icon,
  selected,
  onPress,
  color = colors.primary,
  testID,
}: {
  label: string;
  icon?: IconName;
  selected?: boolean;
  onPress?: () => void;
  color?: string;
  testID?: string;
}) {
  const content = (
    <>
      {icon ? <Ionicons name={icon} size={15} color={selected ? colors.white : color} /> : null}
      <Text style={[styles.chipText, { color: selected ? colors.white : colors.text }]} numberOfLines={1}>
        {label}
      </Text>
    </>
  );
  if (!onPress) return <View style={[styles.chip, styles.chipStatic]}>{content}</View>;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      testID={testID}
      haptic={false}
      style={[styles.chip, styles.chipPressable, selected && { backgroundColor: color, borderColor: color }]}
    >
      {content}
    </PressableScale>
  );
}

export function Badge({ label, color = colors.primary, bg }: { label: string; color?: string; bg?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: bg ?? `${color}1f` }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function ListItem({
  icon,
  iconColor = colors.primary,
  iconBg = colors.primaryLight,
  title,
  subtitle,
  right,
  onPress,
  testID,
}: {
  icon?: IconName;
  iconColor?: string;
  iconBg?: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  testID?: string;
}) {
  const body = (
    <>
      {icon ? (
        <View style={[styles.listIcon, { backgroundColor: iconBg }]}>
          <Ionicons name={icon} size={20} color={iconColor} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.listTitle} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.listSubtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={20} color={colors.textFaint} /> : null)}
    </>
  );
  if (!onPress) return <View style={styles.listItem}>{body}</View>;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      onPress={onPress}
      testID={testID}
      scaleTo={0.98}
      style={styles.listItem}
    >
      {body}
    </PressableScale>
  );
}

/** A rounded action button like Google Maps' "Directions / Save / Share" row: filled for the main action, tonal for the rest. */
export function Pill({
  icon,
  label,
  onPress,
  primary,
  disabled,
  floating,
  testID,
  accessibilityLabel,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  /** White with a shadow, for chips that float over the map. */
  floating?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const fg = primary ? colors.white : colors.primaryDark;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      scaleTo={0.95}
      style={[
        styles.pill,
        primary ? styles.pillPrimary : floating ? styles.pillFloating : styles.pillTonal,
        disabled && styles.disabled,
      ]}
    >
      <Ionicons name={icon} size={16} color={fg} />
      <Text style={[styles.pillText, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

export function SectionTitle({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={type.label}>{children}</Text>
      {right}
    </View>
  );
}

/** A disclosure: tap the header to show or hide details, with an animated chevron. */
export function Collapsible({
  title,
  icon = 'information-circle-outline',
  children,
  initiallyOpen = false,
  testID,
}: {
  title: string;
  icon?: IconName;
  children: ReactNode;
  initiallyOpen?: boolean;
  testID?: string;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const spin = useState(() => new Animated.Value(initiallyOpen ? 1 : 0))[0];
  useEffect(() => {
    Animated.timing(spin, { toValue: open ? 1 : 0, duration: 180, useNativeDriver: nativeDriver }).start();
  }, [open, spin]);
  return (
    <View style={styles.collapsible}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        testID={testID}
        onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setOpen((o) => !o);
        }}
        style={styles.collapsibleHeader}
      >
        <Ionicons name={icon} size={17} color={colors.secondary} />
        <Text style={styles.collapsibleTitle}>{title}</Text>
        <Animated.View style={{ transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }] }}>
          <Ionicons name="chevron-down" size={18} color={colors.secondary} />
        </Animated.View>
      </Pressable>
      {open ? <View style={styles.collapsibleBody}>{children}</View> : null}
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; icon?: IconName }[];
  value: T;
  onChange: (v: T) => void;
}) {
  // Five or more tabs: icon above a smaller label so every name stays readable on a phone.
  const stacked = options.length > 4;
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => {
              tapFeedback('select');
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              onChange(o.value);
            }}
            style={[styles.segment, stacked && styles.segmentStacked, on && styles.segmentOn]}
          >
            {o.icon ? <Ionicons name={o.icon} size={16} color={on ? colors.primaryDark : colors.textMuted} /> : null}
            <Text style={[styles.segmentText, stacked && styles.segmentTextStacked, on && styles.segmentTextOn]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={30} color={colors.primary} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {text ? <Text style={[styles.muted, { textAlign: 'center' }]}>{text}</Text> : null}
      {action}
    </View>
  );
}

/** Fades and slides its children in on mount; used for content that arrives late. */
export function FadeIn({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: ViewStyle }) {
  const v = useState(() => new Animated.Value(0))[0];
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 260, delay, useNativeDriver: nativeDriver }).start();
  }, [v, delay]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

export const styles = StyleSheet.create({
  button: {
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flexGrow: 1 },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  buttonText: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  disabled: { opacity: 0.45 },
  iconButton: { alignItems: 'center', justifyContent: 'center' },
  banner: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radius.md,
    marginVertical: spacing.xs,
    alignItems: 'flex-start',
  },
  bannerText: { fontSize: 13, lineHeight: 18, flex: 1 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm + 2,
    ...shadow.card,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  cardIcon: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...type.heading, flex: 1 },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
    gap: spacing.md,
  },
  infoLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  infoLabel: { fontSize: 13, color: colors.textMuted },
  infoValue: { fontSize: 13, color: colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginVertical: spacing.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipStatic: { minHeight: 28, backgroundColor: colors.surfaceAlt, borderColor: colors.border },
  chipPressable: { minHeight: 34, backgroundColor: colors.surface, borderColor: colors.border },
  chipText: { fontSize: 13, fontWeight: '500' },
  badge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
  badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.1 },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  listIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  listSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  sectionTitle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  collapsible: { marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  collapsibleHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  collapsibleTitle: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.secondary },
  collapsibleBody: { paddingBottom: spacing.xs },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1 },
  pillPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillTonal: { backgroundColor: colors.surface, borderColor: colors.border },
  pillFloating: { backgroundColor: colors.surface, borderColor: colors.surface, ...shadow.float },
  pillText: { fontSize: 13, fontWeight: '600' },
  segmented: {
    flexDirection: 'row',
    backgroundColor: '#e5ece7',
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    minHeight: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  segmentOn: { backgroundColor: colors.surface, ...shadow.card },
  segmentStacked: { flexDirection: 'column', gap: 2, paddingHorizontal: 2 },
  segmentTextStacked: { fontSize: 11 },
  segmentText: { fontSize: 13, fontWeight: '500', color: colors.textMuted },
  segmentTextOn: { color: colors.primaryDark, fontWeight: '700' },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { ...type.heading, textAlign: 'center' },
  body: type.body,
  muted: type.small,
});
