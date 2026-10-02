import { Link } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { DueBadge } from './DueBadge';
import type { Task } from '../types/task';
import { colors, radius, space } from '../lib/theme';

type Props = {
  task: Task;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
};

// 列表里的一行。左边打勾、中间文字、右边进详情。
// 长按整行会问你要不要删掉它。
export function TaskRow({ task, onToggle, onDelete }: Props) {
  const confirmDelete = () => {
    Alert.alert('删掉这条任务？', task.title, [
      { text: '再想想', style: 'cancel' },
      { text: '删掉', style: 'destructive', onPress: () => onDelete(task.id) },
    ]);
  };

  // 只有备注或截止日期至少有一个时，下面那一行才需要占位置
  const hasMeta = task.note.length > 0 || task.dueDate !== null;

  return (
    <Pressable style={styles.row} onLongPress={confirmDelete} delayLongPress={350}>
      <Pressable
        onPress={() => onToggle(task.id)}
        hitSlop={12}
        style={[styles.check, task.done && styles.checkOn]}
      >
        {task.done ? <Text style={styles.tick}>✓</Text> : null}
      </Pressable>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          {/* 重要的任务，标题前面点一颗星。不做成整行变色：整行红一片，
              列表一多会像报错页面，反而看不清哪条是哪条。 */}
          {task.important ? (
            <Text style={[styles.star, task.done && styles.starDone]}>★</Text>
          ) : null}
          <Text style={[styles.title, task.done && styles.titleDone]} numberOfLines={2}>
            {task.title}
          </Text>
        </View>

        {hasMeta ? (
          <View style={styles.metaRow}>
            {task.note ? (
              <Text style={styles.note} numberOfLines={1}>
                {task.note}
              </Text>
            ) : (
              // 没写备注时也占住剩下的宽度，好把徽章推到最右边
              <View style={styles.spacer} />
            )}
            {/* muted：已完成的任务不再喊「逾期」，免得看着焦虑 */}
            <DueBadge dueDate={task.dueDate} muted={task.done} />
          </View>
        ) : null}
      </View>

      <Link href={`/task/${task.id}`} style={styles.more}>
        详情
      </Link>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  tick: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 16,
  },
  body: {
    flex: 1,
    gap: 4,
  },
  titleRow: {
    flexDirection: 'row',
    // 星星跟第一行文字对齐；标题换到第二行时，星星不会跟着往下掉
    alignItems: 'flex-start',
    gap: 4,
  },
  star: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.star,
  },
  // 做完的事不再抢注意力 —— 跟截止日期徽章变灰是同一个道理
  starDone: {
    opacity: 0.35,
  },
  title: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
  },
  titleDone: {
    color: colors.sub,
    textDecorationLine: 'line-through',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  note: {
    flexShrink: 1,
    fontSize: 12,
    color: colors.sub,
  },
  spacer: {
    flex: 1,
  },
  more: {
    fontSize: 13,
    color: colors.accent,
  },
  catPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  catDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  catText: {
    fontSize: 11,
    fontWeight: '500',
  },
});
