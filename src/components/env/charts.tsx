import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { colors, radius, spacing } from '../../theme/colors';
import { tapFeedback } from '../ui';

/**
 * Bar chart of up to a dozen values. Tap a bar to read its exact value; the tallest
 * bar is highlighted until then. Missing values draw as an empty slot, never as zero.
 */
export function BarChart({
  values,
  labels,
  axisLabels = labels,
  format,
  color = colors.secondary,
  barColors,
  height = 120,
  reference,
  testID,
}: {
  values: (number | null)[];
  /** Full labels for the readout above the chart. */
  labels: string[];
  /** Short labels under each bar; defaults to `labels`. */
  axisLabels?: string[];
  format: (v: number, i: number) => string;
  color?: string;
  /** Per-bar colours, e.g. wet and dry months; falls back to `color`. */
  barColors?: (string | null)[];
  height?: number;
  /** Optional dashed line, e.g. a long-term average. */
  reference?: { value: number; label: string };
  testID?: string;
}) {
  const present = values.filter((v): v is number => v !== null);
  const max = Math.max(1, ...present, reference?.value ?? 0);
  const peak = present.length ? values.indexOf(Math.max(...present)) : -1;
  const [picked, setPicked] = useState<number | null>(null);
  const active = picked ?? peak;

  return (
    <View testID={testID}>
      <Text style={s.readout} accessibilityLiveRegion="polite">
        {active >= 0 && values[active] !== null ? `${labels[active]} · ${format(values[active] as number, active)}` : ' '}
      </Text>
      <View style={[s.plot, { height }]}>
        {reference ? (
          <View style={[s.reference, { bottom: (reference.value / max) * height }]} pointerEvents="none">
            <Text style={s.referenceText}>{reference.label}</Text>
          </View>
        ) : null}
        {values.map((v, i) => (
          <Pressable
            key={i}
            accessibilityRole="button"
            accessibilityLabel={`${labels[i]}: ${v === null ? '–' : format(v, i)}`}
            onPress={() => {
              tapFeedback('select');
              setPicked(i);
            }}
            style={s.column}
          >
            <View
              style={[
                s.bar,
                v === null
                  ? s.missing
                  : { height: Math.max(3, (v / max) * height), backgroundColor: barColors?.[i] ?? color, opacity: i === active ? 1 : 0.45 },
              ]}
            />
          </Pressable>
        ))}
      </View>
      <View style={s.labels}>
        {axisLabels.map((l, i) => (
          <Text key={i} style={[s.label, i === active && { color: colors.text, fontWeight: '700' }]} numberOfLines={1}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** One horizontal bar split by share, with a legend underneath. */
export function StackedBar({ parts }: { parts: { label: string; fraction: number; color: string }[] }) {
  return (
    <View>
      <View style={s.stack}>
        {parts.map((p, i) => (
          <View key={i} style={{ flex: Math.max(p.fraction, 0.002), backgroundColor: p.color }} />
        ))}
      </View>
      <View style={s.legend}>
        {parts.map((p, i) => (
          <View key={i} style={s.legendItem}>
            <View style={[s.swatch, { backgroundColor: p.color }]} />
            <Text style={s.legendText}>
              {p.label} <Text style={{ fontWeight: '700' }}>{Math.round(p.fraction * 100)}%</Text>
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * A crop's tolerated range (light), optimal range (strong) and where this site sits (marker).
 * The axis spans a little past the tolerated range so out-of-range values stay visible.
 */
export function RangeBar({
  range,
  value,
  color,
  format,
}: {
  range: { absMin: number; optMin: number; optMax: number; absMax: number };
  value: number | null;
  color: string;
  format: (v: number) => string;
}) {
  const span = range.absMax - range.absMin || 1;
  const lo = range.absMin - span * 0.15;
  const hi = range.absMax + span * 0.15;
  const pct = (v: number) => `${((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 100}%` as const;
  return (
    <View>
      <View style={s.rangeTrack}>
        <View style={[s.rangeSeg, { left: pct(range.absMin), width: `${((range.absMax - range.absMin) / (hi - lo)) * 100}%`, backgroundColor: `${color}33` }]} />
        <View style={[s.rangeSeg, { left: pct(range.optMin), width: `${((range.optMax - range.optMin) / (hi - lo)) * 100}%`, backgroundColor: `${color}99` }]} />
        {value !== null ? <View style={[s.marker, { left: pct(value) }]} /> : null}
      </View>
      <View style={s.rangeLabels}>
        <Text style={s.rangeLabel}>{format(range.absMin)}</Text>
        <Text style={[s.rangeLabel, { color: colors.text }]}>
          {format(range.optMin)}–{format(range.optMax)}
        </Text>
        <Text style={s.rangeLabel}>{format(range.absMax)}</Text>
      </View>
    </View>
  );
}

export function ScoreRing({ score, color, size = 58 }: { score: number | null; color: string; size?: number }) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = score === null ? 0 : (score / 100) * c;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.border} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${filled} ${c}`}
          strokeLinecap="round"
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <Text style={[s.ringText, { color }]}>{score === null ? '–' : score}</Text>
    </View>
  );
}

/** pH scale 4–9 coloured acid → neutral → alkaline, with a marker and the model's 90 % range. */
export function PhScale({ value, low, high }: { value: number; low: number | null; high: number | null }) {
  const pct = (v: number) => `${((Math.min(9, Math.max(4, v)) - 4) / 5) * 100}%` as const;
  const stops = ['#d9534f', '#f0ad4e', '#e8d84a', '#7cc35b', '#3aa1a0', '#3b6fb6'];
  return (
    <View>
      <View style={s.phTrack}>
        <View style={s.phStops}>
          {stops.map((c, i) => (
            <View key={i} style={{ flex: 1, backgroundColor: c }} />
          ))}
        </View>
        {low !== null && high !== null ? (
          <View style={[s.phBand, { left: pct(low), width: `${((Math.min(9, high) - Math.max(4, low)) / 5) * 100}%` }]} />
        ) : null}
        <View style={[s.phMarker, { left: pct(value) }]} />
      </View>
      <View style={s.rangeLabels}>
        {[4, 5, 6, 7, 8, 9].map((n) => (
          <Text key={n} style={s.rangeLabel}>
            {n}
          </Text>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  readout: { fontSize: 12, fontWeight: '700', color: colors.text, marginBottom: spacing.sm, minHeight: 20 },
  plot: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  column: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { borderTopLeftRadius: 5, borderTopRightRadius: 5, width: '100%' },
  missing: { height: 3, backgroundColor: colors.border },
  reference: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: colors.textMuted, zIndex: 1 },
  referenceText: { position: 'absolute', right: 0, top: -17, fontSize: 11, color: colors.textMuted, backgroundColor: colors.surface, paddingHorizontal: 3 },
  labels: { flexDirection: 'row', gap: 4, marginTop: 6 },
  label: { flex: 1, textAlign: 'center', fontSize: 11, color: colors.textMuted },
  stack: { flexDirection: 'row', height: 18, borderRadius: radius.sm, overflow: 'hidden' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 12, height: 12, borderRadius: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: '#0002' },
  legendText: { fontSize: 13, color: colors.text },
  rangeTrack: { height: 14, borderRadius: 7, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  rangeSeg: { position: 'absolute', top: 0, bottom: 0, borderRadius: 7 },
  marker: {
    position: 'absolute',
    width: 6,
    height: 22,
    marginLeft: -3,
    borderRadius: 3,
    backgroundColor: colors.text,
    borderWidth: 1.5,
    borderColor: colors.white,
  },
  rangeLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  rangeLabel: { fontSize: 11, color: colors.textMuted },
  ringText: { fontSize: 15, fontWeight: '700' },
  phTrack: { height: 16, justifyContent: 'center' },
  phStops: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, flexDirection: 'row', borderRadius: 8, overflow: 'hidden' },
  phBand: { position: 'absolute', top: -3, bottom: -3, borderWidth: 2, borderColor: colors.text, borderRadius: 6, opacity: 0.5 },
  phMarker: {
    position: 'absolute',
    width: 8,
    height: 26,
    marginLeft: -4,
    borderRadius: 4,
    backgroundColor: colors.text,
    borderWidth: 2,
    borderColor: colors.white,
  },
});
