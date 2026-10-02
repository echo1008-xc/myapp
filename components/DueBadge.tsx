import { StyleSheet, Text, View } from 'react-native';
import { describeDue } from '../lib/date';
import { colors, radius } from '../lib/theme';

// 截止日期的小徽章。列表和详情页都用它，所以只在这里定义一次颜色。
// 颜色一律从 lib/theme.ts 取，页面里不出现色值。
const TONE = {
  overdue: { bg: colors.dangerSoft, fg: colors.danger },
  today: { bg: colors.dangerSoft, fg: colors.danger },
  soon: { bg: colors.warnSoft, fg: colors.warn },
  later: { bg: colors.surface, fg: colors.sub },
};

type Props = {
  // "2026-09-20" 这种字符串；没设截止日期就传 null
  dueDate: string | null;
  // 已完成的任务不该再喊「逾期」，所以把它压成灰色
  muted?: boolean;
  size?: 'sm' | 'md';
};

// 传进来的日期不合法或为空时，这个组件自己不显示（返回 null）。
// 这样调用方就不用写 if 了。
export function DueBadge({ dueDate, muted = false, size = 'sm' }: Props) {
  const info = describeDue(dueDate);
  if (!info) {
    return null;
  }
  const tone = muted ? TONE.later : TONE[info.tone];
  const big = size === 'md';

  return (
    <View style={[styles.badge, big && styles.badgeMd, { backgroundColor: tone.bg }]}>
      <Text style={[styles.text, big && styles.textMd, { color: tone.fg }]}>{info.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  badgeMd: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  text: {
    fontSize: 11,
    lineHeight: 16,
  },
  textMd: {
    fontSize: 12,
    lineHeight: 18,
  },
});
