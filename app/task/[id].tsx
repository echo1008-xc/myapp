import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { DueBadge } from '../../components/DueBadge';
import { StateView } from '../../components/StateView';
import { CATEGORIES, getCategory } from '../../lib/categories';
import type { CategoryKey } from '../../lib/categories';
import { fetchTask, removeTask, saveTask } from '../../lib/api/tasks';
import { describeDue, formatDate, isValidDate, shiftDays } from '../../lib/date';
import type { ScreenState } from '../../lib/store/useTasks';
import { colors, radius, space } from '../../lib/theme';
import type { Task } from '../../types/task';

// 快捷按钮：点一下就把截止日期设成某天。
// 大部分时候人想的就是「今天」「明天」，打字反而慢。
const QUICK: { label: string; days: number }[] = [
  { label: '今天', days: 0 },
  { label: '明天', days: 1 },
  { label: '3 天后', days: 3 },
  { label: '1 周后', days: 7 },
];

// 详情页。文件名叫 [id].tsx，方括号表示这里是网址里的变量：
// 访问 /task/3，下面拿到的 id 就是 "3"。
export default function TaskDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const taskId = String(params.id);

  const [task, setTask] = useState<Task | null>(null);
  const [state, setState] = useState<ScreenState>('loading');
  const [message, setMessage] = useState('');

  // 进来是「看」，点「编辑」才进「改」。
  // 不直接一进来就能改，是为了让"我到底改了没有"这件事永远清清楚楚。
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [dueDraft, setDueDraft] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  // 「标为重要」是即时生效的，跟勾选一样 —— 点完马上存盘，
  // 所以单独一个 loading 标记，别和"保存修改"的 saving 混在一起。
  const [flagging, setFlagging] = useState(false);
  // 编辑态里「分类」的草稿。列表里选了哪个分类，就临时记在这里，点保存才生效。
  const [catDraft, setCatDraft] = useState<CategoryKey>('none');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const data = await fetchTask(taskId);
      setTask(data);
      setState('success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '未知错误');
      setState('error');
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 手动输入的日期合法才认，不合法就当没设 —— 避免把 "2026-02-31" 这种存进去。
  // 这两个值每次渲染重算，不额外存 state，就不会出现"显示的和保存的不一样"。
  const dueText = dueDraft.trim();
  const dueDate = dueText && isValidDate(dueText) ? dueText : null;
  const dueError = dueText && !isValidDate(dueText) ? '日期格式要像 2026-09-20' : '';

  // 点一下星星就切换「重要」，不绕编辑态。
  // 为什么它不走「编辑 → 保存修改」：这是二选一的开关，点完立刻能看到星星亮没亮，
  // 再要求你去点一次"保存"，只会让人忘了点、然后以为坏了。
  // 注意存盘用的是整条 task 展开后改一个字段（...task），标题备注那些一个都不会丢。
  const toggleImportant = async () => {
    if (!task || flagging) {
      return;
    }
    setFlagging(true);
    try {
      const next: Task = { ...task, important: !task.important };
      await saveTask(next);
      // 存成功了才改屏幕上的值 —— 反过来的话，存失败就会显示成"已经改了"
      setTask(next);
    } catch (error) {
      Alert.alert('没能改成', error instanceof Error ? error.message : '请再试一次');
    } finally {
      setFlagging(false);
    }
  };

  // 把当前值拷进草稿，进入编辑态
  const startEdit = () => {
    if (!task) {
      return;
    }
    setTitle(task.title);
    setNote(task.note);
    setDueDraft(task.dueDate ?? '');
    setCatDraft(task.category);
    setFormError('');
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setFormError('');
  };

  // 保存：先校验，再落盘，成功后才退回列表。
  // 顺序很重要 —— 存失败就留在原地，不让你以为存上了。
  const submit = async () => {
    if (!task) {
      return;
    }
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFormError('标题不能空着');
      return;
    }
    if (dueError) {
      setFormError(dueError);
      return;
    }
    setFormError('');
    setSaving(true);
    try {
      await saveTask({
        ...task,
        title: trimmedTitle,
        note: note.trim(),
        dueDate,
        category: catDraft,
      });
      router.back();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '保存失败');
      setSaving(false);
    }
  };

  // 删之前先问一句。删完自动退回列表，列表会跟着刷新。
  const confirmDelete = () => {
    Alert.alert('删掉这条任务？', task?.title ?? '', [
      { text: '再想想', style: 'cancel' },
      {
        text: '删掉',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await removeTask(taskId);
            router.back();
          })();
        },
      },
    ]);
  };

  const due = describeDue(task?.dueDate ?? null);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: editing ? '编辑任务' : '任务详情' }} />
      <StateView
        state={state}
        message={message}
        onRetry={() => {
          void load();
        }}
      >
        {task ? (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {editing ? (
              <>
                <Text style={styles.banner}>改完点最下面的「保存修改」，不点就不生效</Text>

                <Text style={styles.fieldLabel}>标题</Text>
                <TextInput
                  style={styles.titleInput}
                  value={title}
                  onChangeText={(text) => {
                    setTitle(text);
                    setFormError('');
                  }}
                  placeholder="要做的事"
                  placeholderTextColor={colors.sub}
                  maxLength={80}
                />

                <Text style={styles.fieldLabel}>备注</Text>
                <TextInput
                  style={[styles.input, styles.noteInput]}
                  value={note}
                  onChangeText={setNote}
                  placeholder="补充说明，可以不填"
                  placeholderTextColor={colors.sub}
                  multiline
                  textAlignVertical="top"
                  maxLength={300}
                />

                <Text style={styles.fieldLabel}>截止日期</Text>
                <View style={styles.chipRow}>
                  {QUICK.map((item) => {
                    const value = shiftDays(item.days);
                    const on = dueDate === value;
                    return (
                      <Pressable
                        key={item.label}
                        style={[styles.chip, on && styles.chipOn]}
                        onPress={() => {
                          setDueDraft(value);
                          setFormError('');
                        }}
                      >
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>
                          {item.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                  <Pressable
                    style={styles.chip}
                    onPress={() => {
                      setDueDraft('');
                      setFormError('');
                    }}
                  >
                    <Text style={styles.chipText}>清除</Text>
                  </Pressable>
                </View>

                <TextInput
                  style={styles.input}
                  value={dueDraft}
                  onChangeText={(text) => {
                    setDueDraft(text);
                    setFormError('');
                  }}
                  placeholder="或手动输入：2026-09-20"
                  placeholderTextColor={colors.sub}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={10}
                />

                {dueError ? <Text style={styles.errorText}>{dueError}</Text> : null}
                <Text style={styles.hintText}>
                  {dueDate
                    ? `将设为 ${formatDate(dueDate)}（${describeDue(dueDate)?.label ?? ''}）`
                    : '不填就是不设截止日期'}
                </Text>

                <Text style={styles.fieldLabel}>分类</Text>
                <View style={styles.catRow}>
                  {CATEGORIES.map((c) => {
                    const on = catDraft === c.key;
                    return (
                      <Pressable
                        key={c.key}
                        style={[styles.catChip, on && { borderColor: c.color, backgroundColor: c.soft }]}
                        onPress={() => setCatDraft(c.key)}
                      >
                        <View style={[styles.catDot, { backgroundColor: c.color }]} />
                        <Text style={[styles.catChipText, on && { color: c.color }]}>{c.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

                <Pressable
                  style={[styles.primaryBtn, saving && styles.primaryBtnOff]}
                  onPress={() => {
                    void submit();
                  }}
                  disabled={saving}
                >
                  <Text style={styles.primaryText}>{saving ? '保存中…' : '保存修改'}</Text>
                </Pressable>

                <Pressable style={styles.ghostBtn} onPress={cancelEdit}>
                  <Text style={styles.ghostText}>取消，不改了</Text>
                </Pressable>
              </>
            ) : (
              <>
                <View style={styles.titleRow}>
                  {task.important ? <Text style={styles.star}>★</Text> : null}
                  <Text style={styles.title}>{task.title}</Text>
                </View>

                <View style={styles.card}>
                  <Text style={styles.label}>备注</Text>
                  <Text style={styles.value}>{task.note || '（没写备注）'}</Text>
                </View>

                <View style={styles.card}>
                  <Text style={styles.label}>截止日期</Text>
                  {task.dueDate ? (
                    <View style={styles.dueRow}>
                      <DueBadge dueDate={task.dueDate} size="md" />
                      <Text style={styles.value}>{task.dueDate}</Text>
                    </View>
                  ) : (
                    <Text style={styles.value}>（没设截止日期）</Text>
                  )}
                </View>

                <View style={styles.card}>
                  <Text style={styles.label}>分类</Text>
                  <View style={[styles.catPill, { backgroundColor: getCategory(task.category).soft }]}>
                    <View style={[styles.catDot, { backgroundColor: getCategory(task.category).color }]} />
                    <Text style={[styles.catText, { color: getCategory(task.category).color }]}>
                      {getCategory(task.category).label}
                    </Text>
                  </View>
                </View>

                <View style={styles.card}>
                  <Text style={styles.label}>状态</Text>
                  <Text style={styles.value}>
                    {task.important ? '重要 · ' : ''}
                    {task.done ? '已完成' : '未完成'}
                    {due?.tone === 'overdue' && !task.done ? ' · 已过期' : ''}
                  </Text>
                </View>

                <View style={styles.card}>
                  <Text style={styles.label}>创建日期</Text>
                  <Text style={styles.value}>{task.createdAt}</Text>
                </View>

                <Pressable
                  style={[styles.flagBtn, task.important && styles.flagBtnOn]}
                  onPress={() => {
                    void toggleImportant();
                  }}
                  disabled={flagging}
                >
                  <Text style={[styles.flagText, task.important && styles.flagTextOn]}>
                    {task.important ? '★ 已标为重要 —— 点一下取消' : '☆ 标为重要'}
                  </Text>
                </Pressable>

                <Pressable style={styles.primaryBtn} onPress={startEdit}>
                  <Text style={styles.primaryText}>编辑</Text>
                </Pressable>

                <Pressable style={styles.deleteBtn} onPress={confirmDelete}>
                  <Text style={styles.deleteText}>删掉这条任务</Text>
                </Pressable>
              </>
            )}
          </ScrollView>
        ) : null}
      </StateView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: space.md,
    gap: space.sm,
  },
  banner: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.accent,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: space.sm,
  },
  star: {
    fontSize: 18,
    lineHeight: 28,
    color: colors.star,
  },
  title: {
    flex: 1,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '500',
    color: colors.text,
  },
  fieldLabel: {
    fontSize: 12,
    color: colors.sub,
    marginTop: space.sm,
  },
  titleInput: {
    minHeight: 48,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    fontSize: 17,
    color: colors.text,
  },
  input: {
    minHeight: 46,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    fontSize: 14,
    color: colors.text,
  },
  noteInput: {
    minHeight: 96,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  chipOn: {
    backgroundColor: colors.accent,
  },
  chipText: {
    fontSize: 13,
    color: colors.text,
  },
  chipTextOn: {
    color: '#FFFFFF',
  },
  hintText: {
    fontSize: 12,
    color: colors.sub,
  },
  errorText: {
    fontSize: 12,
    color: colors.danger,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
    gap: 4,
  },
  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  label: {
    fontSize: 12,
    color: colors.sub,
  },
  value: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.text,
  },
  // 未标重要：一条安静的描边按钮；标了重要：浅金底 + 金字，状态一眼可辨
  flagBtn: {
    marginTop: space.md,
    height: 46,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flagBtnOn: {
    backgroundColor: colors.starSoft,
    borderColor: colors.star,
  },
  flagText: {
    fontSize: 15,
    color: colors.text,
  },
  flagTextOn: {
    color: colors.star,
    fontWeight: '500',
  },
  primaryBtn: {
    marginTop: space.md,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnOff: {
    backgroundColor: colors.line,
  },
  primaryText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  ghostBtn: {
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: {
    fontSize: 14,
    color: colors.sub,
  },
  deleteBtn: {
    marginTop: space.sm,
    height: 46,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: {
    fontSize: 15,
    color: colors.danger,
  },
  catPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  catDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  catText: {
    fontSize: 13,
    fontWeight: '500',
  },
  catRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  catChipText: {
    fontSize: 13,
    color: colors.text,
  },
});
