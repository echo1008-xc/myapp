import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { StateView } from '../../components/StateView';
import { TaskRow } from '../../components/TaskRow';
import { useTasks } from '../../lib/store/useTasks';
import { colors, radius, space } from '../../lib/theme';
import { CATEGORIES } from '../../lib/categories';
import type { CategoryKey } from '../../lib/categories';
import type { Task } from '../../types/task';
// 今日三餐：数据来自餐盘页记下的账本（lib/meal/log.ts）。
// 这一页只**读**它，绝不自己算营养；点某一笔会跳到餐盘页把它摆出来。
import {
  SLOT_KEYS,
  misdatedEntries,
  readLog,
  repairMisdated,
  slotLabel,
  streakDays,
  summarizeDay,
} from '../../lib/meal/log';
import type { RepairRecord } from '../../lib/meal/log';
import type { MealLogEntry, MealSlot } from '../../lib/meal/log';
// 目标：每天该吃多少热量、多少碳水。详情页点进去填年龄身高体重（app/target.tsx），
// 这一页只读结果 —— 「该吃多少」和「吃了多少」并排摆着，才有比较的意义。
import { dailyTarget, readProfile } from '../../lib/profile';
import type { Target } from '../../lib/profile';
import { formatDate, today } from '../../lib/date';
import { dateOfTimestamp } from '../../lib/meal/log';
// 今日三餐那张卡片的网格（行 / 行头 / 数字组 / 大间隔）来自共用组件，
// 和记录页（tbd2）是同一份实现 —— 详见 components/NumRow.tsx。
import { GridDivider, GridFoot, GridLabel, GridNote, GridRow, GridSpacer, NumCell } from '../../components/NumRow';

// ⚠️ 2026-10-02 记一笔：这里原来有一行「批次号 + 云端版本 + 账本几顿 / 最近一顿
// 记在哪天、什么时候拍的」两行排障小字，夹在标题和标语之间 —— 用户没要求过，
// 是我排查问题时塞进去的，2026-10-02 下午删干净了（状态、常量、计算一块儿删）。
// 以后查"新代码推上去了没有"改用打包时生成的 `.hbc.map`（里面是真实编译进 App 的源码）。

// 四种筛选。用固定的几个值而不是随意的字符串：
// 打错字的时候编辑器会当场报错，不会等到手机上才发现。
type Filter = 'all' | 'todo' | 'done' | 'important';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'todo', label: '未完成' },
  { key: 'done', label: '已完成' },
  { key: 'important', label: '重要' },
];

// 列表被筛成空白时要说的话。
// 为什么非得一个一个分开写：只留一片空白，人会以为「我的数据是不是丢了」——
// 这是所有清单类 App 最容易吓到人的地方，一句对症的话比什么都管用。
function emptyHintText(filter: Filter, query: string): string {
  if (query.trim()) {
    return `没有找到含「${query.trim()}」的内容`;
  }
  if (filter === 'todo') {
    return '未完成的任务一条都没有 —— 全干完了';
  }
  if (filter === 'important') {
    return '还没有标为重要的任务 —— 进详情页点一下「☆ 标为重要」';
  }
  return '还没有已完成的任务，去点个小圆圈试试';
}

// 首页网格里的一「组」——「说明文字 + 数字 + 单位」，三截贴紧、当成一个整体。
// 结构和间距全在 components/NumRow.tsx 里（记录页和这里**共用同一份**）：
// 那一页原来自己各写一份、右边还写成竖排两句话，看着就不像这里；共用后两边长得一样。

// 今日合计超出目标多少，对应哪个警告色（2026-09-29 用户定）。
// 分段：超出 ≤20% → 黄；20%~50% → 橘黄；>50% → 红；没超 → null（主色）。
// 目标没设置 / 目标 ≤ 0 时不算（没有基准就谈不上超）。
function overTone(today: number, goal: number | undefined): 'warn' | 'over' | 'danger' | null {
  if (!goal || goal <= 0 || today <= goal) {
    return null;
  }
  const ratio = (today - goal) / goal;
  if (ratio <= 0.2) return 'warn';
  if (ratio <= 0.5) return 'over';
  return 'danger';
}


// 首页。你第一次跑起来看到的就是这一页。
export default function HomeScreen() {
  const { tasks, state, message, reload, refresh, add, toggle, remove } = useTasks();
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  // 分类筛选：'all' 表示不按分类筛。和上面的状态筛选是两条独立的线，可以叠加。
  const [catFilter, setCatFilter] = useState<CategoryKey | 'all'>('all');

  // ---------- 今日三餐（2026-09-26 新增）----------
  // 全部记录都读进来，早中晚怎么加、连续几天，都交给 lib/meal/log.ts 里的函数算
  // （那套算法有它自己的测试，页面里再算一遍迟早会算出两个版本）。
  const [mealLog, setMealLog] = useState<MealLogEntry[]>([]);
  const router = useRouter();

  // ---------- 「记录被搬错日子」那道提示条（2026-10-02）----------
  // 老 bug（餐盘页写账硬写 today()）会把某一天的一顿记到另一天去 ——
  // 照片、数字都在，只是"日子"被挪了。判据见 lib/meal/log.ts 的 isMisdated：
  // 「它记在哪一天」和「它是什么时候拍的」对不上 = 被搬过。
  // null = 一切正常，不摆任何东西（没毛病就不能拿个条子吓人）。
  const [misdated, setMisdated] = useState<RepairRecord[] | null>(null);
  const [repairedHint, setRepairedHint] = useState<string | null>(null);

  // ---------- 目标（2026-09-26 新增）----------
  // 首页最上面那一条。和「今日」那条是配套的：一条是"该吃多少"、一条是"吃了多少"。
  // 没设置过时是 null —— 界面上写「还没设置」，**不拿默认值冒充用户的目标**
  // （默认值只用来把详情页的框填好，见 lib/profile.ts）。
  const [target, setTarget] = useState<Target | null>(null);

  const loadTarget = useCallback(async () => {
    const saved = await readProfile();
    setTarget(saved ? dailyTarget(saved) : null);
  }, []);

  useEffect(() => {
    void loadTarget();
  }, [loadTarget]);

  // 每次账本重读都顺手体检一遍：有没有哪一条"日子和拍照时刻对不上"。
  // 只报数、不动手 —— 改数据这件事必须用户点一下才发生。
  const loadMeals = useCallback(async () => {
    const all = await readLog();
    setMealLog(all);
    setMisdated(misdatedEntries(all).map((e) => ({
      id: e.id,
      from: e.date,
      to: dateOfTimestamp(e.at),
      slot: e.slot,
    })));
  }, []);

  // 用户点了「放回原处」：只把那几条的日子拧回去，别的分毫不动。
  const applyRepair = useCallback(async () => {
    const rep = await repairMisdated();
    if (rep.fixed.length === 0) {
      setRepairedHint('没找到要修的记录，账本是好的。');
      return;
    }
    const parts = rep.fixed.map(
      (f) => `${formatDate(f.to)} 的${slotLabel(f.slot)}（从 ${formatDate(f.from)} 挪回来）`,
    );
    setRepairedHint(`已放回原处：${parts.join('、')}。`);
    if (rep.clashes.length > 0) {
      setRepairedHint(
        `${parts.join('、')}。另有 ${rep.clashes.length} 处同一天同一餐撞上了另一条记录，没替你删，进那一餐自己看一眼。`,
      );
    }
    setMisdated(null);
    await loadMeals();
  }, [loadMeals]);

  useEffect(() => {
    void loadMeals();
  }, [loadMeals]);

  // 今天这一页要显示的四组数字，全在这里算一次。
  const day = useMemo(() => summarizeDay(mealLog, today()), [mealLog]);
  const streak = useMemo(() => streakDays(mealLog, today()), [mealLog]);

  // 点某一笔 → 跳到「饮食」那一页，把当时那张照片和底下的分析摆出来。
  // 多带一个 t（点下去的这一刻）：见 meal.tsx 里的说明 ——
  // 不带它的话，"点进去 → 拍张新的 → 再点同一餐"不会重新还原。
  const openEntry = useCallback(
    (id: string) => {
      router.push({ pathname: '/meal', params: { entry: id, t: String(Date.now()) } });
    },
    [router],
  );

  // 「还没拍」的入口（2026-09-29）：点某一餐后面的「还没拍」= 这次拍的就是这一餐。
  // 带两个参数（见 meal.tsx）：preset = 哪一餐，pt = 点下去这一刻（每次点都算新请求）。
  // 从这里进的照片拍完**自动归这一餐，不用再选**；只有从底部「餐前拍」
  // 标签进去的才保持老规矩（拍完再选早/中/晚）。
  const startPreset = useCallback(
    (slot: MealSlot) => {
      router.push({ pathname: '/meal', params: { preset: slot, pt: String(Date.now()) } });
    },
    [router],
  );

  // 从详情页改完 / 删完退回来时，列表要跟着变。
  // 第一次进来先跳过（数据已经加载过了），免得白转一次圈。
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void refresh();
      // 从餐盘页记完一笔回到这一页时，三餐那几行必须当场变 ——
      // 不然用户会以为"我明明记了，首页怎么还是空的"。
      void loadMeals();
      // 同上：从「目标」改完体重回来，上面那行数字要当场变。
      void loadTarget();
    }, [refresh, loadMeals, loadTarget]),
  );

  // 四个筛选各有多少条。只遍历一次，不把 filter 写四遍。
  const counts = useMemo(() => {
    let todo = 0;
    let important = 0;
    for (const t of tasks) {
      if (!t.done) {
        todo += 1;
      }
      if (t.important) {
        important += 1;
      }
    }
    return { all: tasks.length, todo, done: tasks.length - todo, important };
  }, [tasks]);

  // 真正显示的列表 = 先按筛选挑，再按关键词筛。
  // useMemo 的意思是"原始数据没变就别重算"，任务多了也不会卡。
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (filter === 'todo' && t.done) {
        return false;
      }
      if (filter === 'done' && !t.done) {
        return false;
      }
      if (filter === 'important' && !t.important) {
        return false;
      }
      if (catFilter !== 'all' && t.category !== catFilter) {
        return false;
      }
      if (!q) {
        return true;
      }
      // 标题和备注都参与搜索 —— 明明写了备注却搜不到，会让人以为没存上
      return t.title.toLowerCase().includes(q) || t.note.toLowerCase().includes(q);
    });
  }, [tasks, filter, query, catFilter]);

  const canAdd = draft.trim().length > 0;
  const searching = query.trim().length > 0;
  // 列表空了，是"一条任务都没有"还是"被筛掉了"？
  // 这两种情况必须给出不同的话，否则用户会以为自己的数据丢了。
  const filteredOut = counts.all > 0 && visible.length === 0;

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  // 按下「添加」或键盘上的回车，都走这里。
  const submit = () => {
    if (!canAdd) {
      return;
    }
    void add(draft);
    setDraft('');
  };

  const renderItem = ({ item }: { item: Task }) => (
    <TaskRow task={item} onToggle={toggle} onDelete={remove} />
  );

  return (
    <View style={styles.screen}>
      <View style={styles.body}>
        {/* ---------- App 标语（2026-09-29 用户要求加，**一直在**）----------
            顶部导航栏大标题「糖Gi可De」下面的两行，英文一句、中文一句。
            这两行是用户明确要求的（不是我自作主张加的装饰），**不许删**：
            2026-10-02 我一度误替用户做主撤掉了，被用户纠正回来。
            它只是说明文字，不参与任何计算，点了也没反应，所以不包 Pressable。 */}
        <View style={styles.homeTagline}>
          <Text style={styles.tagline}>Everything may be decrease!</Text>
          <Text style={styles.tagline}>一切皆可降！</Text>
        </View>

        {/* ---------- 「放回原处」提示条 ----------
            有记录的日子被老 bug 挪走时，打开 App 第一眼在这儿看到它。
            黄底（不是红）—— 它是"有笔账日子不对"、不是"出错了"，
            而且点一下就能修好，不点也不会有别的后果。
            为什么**不用**自动改：改用户的账必须得他点一下。自动改的话，
            万一哪天真有个正常的记录被误判（比如改过手机日期），
            悄悄挪回去反而查不出来。 */}
        {misdated && misdated.length > 0 ? (
          <View style={styles.repairBox}>
            <Text style={styles.repairTitle}>
              有 {misdated.length} 顿记的日子不对
            </Text>
            <Text style={styles.repairText}>
              {misdated
                .map((r) => `${formatDate(r.to)} 的${slotLabel(r.slot)}记到了 ${formatDate(r.from)}`)
                .join('；')}
              。照片和数字都在，放回 {formatDate(misdated[0].to)} 就行。
            </Text>
            <View style={styles.repairBtns}>
              <Pressable style={styles.repairGo} onPress={() => void applyRepair()}>
                <Text style={styles.repairGoText}>放回原处</Text>
              </Pressable>
              <Pressable style={styles.repairSkip} onPress={() => setMisdated(null)}>
                <Text style={styles.repairSkipText}>不用</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {repairedHint ? (
          <View style={styles.repairBox}>
            <Text style={styles.repairTitle}>修好了</Text>
            <Text style={styles.repairText}>{repairedHint}</Text>
            <Pressable style={styles.repairSkip} onPress={() => setRepairedHint(null)}>
              <Text style={styles.repairSkipText}>知道了</Text>
            </Pressable>
          </View>
        ) : null}

        {/* ---------- 目标 ----------
            用户 2026-09-26 定：摆在「今日」那条上面，标题两个字「目标」
            （原来叫「我的目标」，去掉"我的"），后面跟每天该吃的总热量、总碳水；
            点开来填年龄、身高、体重。
            淡蓝底是为了跟下面白底的「今日」分开 —— 一张是"该吃多少"、
            一张是"今天吃了多少"，底色不同才不用读字去分辨。
            没设置过就写「还没设置」，数字一律空着。

            ★ 这一条和下面「今日」那条用的是**同一套网格**（styles.grid*），
              而且每一格都拆成「说明 / 数字 / 单位」三段（见 NumCell），
              所以两行的「总热量」「总碳水」、数字的右边缘、两个单位
              全都落在完全相同的竖线上，上下对照着看不用左右找。 */}
        <Pressable
          style={styles.targetCard}
          onPress={() => router.push('/target')}
          accessibilityRole="button"
          accessibilityLabel={target ? '看或修改目标' : '设置目标'}
        >
          <GridRow>
            <GridLabel accent>目标</GridLabel>
            {target ? (
              <>
                <NumCell prefix="总热量" value={target.calories} unit="千卡" accent />
                <GridSpacer />
                <NumCell prefix="总碳水" value={target.carb} unit="克" accent narrow />
              </>
            ) : (
              // 没设置过就不摆数字，只写一句话 —— 不拿默认值冒充分数。
              <GridNote>还没设置</GridNote>
            )}
          </GridRow>
        </Pressable>

        {/* ---------- 今日三餐 ----------
            固定在页面最上面、不跟着任务列表滚 —— 打开 App 第一眼要看见的
            就是「今天一共吃了多少碳水」。
            （用户 2026-09-26 定：就放在首页的最上面；
             标题不要，第一行直接就是今日合计。）
            数据全部来自餐盘页：拍完照、点一下「早餐 / 中餐 / 晚餐」才会出现在这儿。 */}
        <View style={styles.mealCard}>
          {/* 「今日」这一行 = 早 + 中 + 晚，摆在卡片第一行当标题
              （用户 2026-09-26 定：原来的「今日三餐」四个字去掉，
              直接把今天的合计提到最上面）。
              它的数字和三行各自加起来必须相等 —— 三个数都是从同一份
              summary 里取的，不是各算各的。 */}
          <GridRow>
            <GridLabel accent>今日</GridLabel>
            {/* 2026-09-29 用户定：今日合计超过目标值就变色 ——
                黄（≤20%）/ 橘黄（20%~50%）/ 红（>50%）；没超或没设目标 = 主色。
                总热量、总碳水两列都按各自的「今日 vs 目标」走同一套 overTone 分档。 */}
            <NumCell
              prefix="总热量"
              value={day.totalCalories}
              unit="千卡"
              accent
              tone={overTone(day.totalCalories, target?.calories)}
            />
            <GridSpacer />
            <NumCell
              prefix="总碳水"
              value={day.totalCarb}
              unit="克"
              accent
              narrow
              tone={overTone(day.totalCarb, target?.carb)}
            />
          </GridRow>

          <GridDivider />

          {SLOT_KEYS.map((k) => {
            const s = day.slots[k];
            const label = slotLabel(k);
            const has = s.count > 0;
            // 这一餐的那一笔 —— 点这一行时跳的就是它。
            // 2026-09-26 晚起**一餐只留一条**（重拍是把它顶掉，不是再记一笔），
            // 所以 entries 正常就一条；取最后一条只是为了兼容更早的数据
            //（那时候一餐可以存好几笔，还没有"覆盖"这个规矩）。
            const latest = has ? s.entries[s.entries.length - 1] : null;
            return (
              <Pressable
                key={k}
                // 有记录 → 点开回看；没记录 → 点「还没拍」直接去拍这一餐
                //（2026-09-29 定：拍出来的照片直接归这一餐，不用再选）。
                onPress={() => {
                  if (latest) {
                    openEntry(latest.id);
                  } else {
                    startPreset(k);
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  has ? `看${label}记的照片和分析` : `去拍${label}`
                }
              >
                <GridRow tap>
                  <GridLabel>{label}</GridLabel>
                {/* 用户 2026-09-26 晚定：不点开时**只看这一行合计**。
                    原来每餐下面还会再列一行「包子、豆浆　热量 … 碳水 …」，
                    那是噪音 —— 想细看就点这一行，回到当时的照片和完整分析。
                    2026-09-26 夜又定：这一行的数字要和「目标」「今日」两行
                    对齐 —— 所以也走 NumCell，用的还是同一套列宽。 */}
                  {has ? (
                    <>
                      <NumCell prefix="热量" value={s.calories} unit="千卡" />
                      <GridSpacer />
                      <NumCell prefix="碳水" value={s.carb} unit="克" narrow />
                    </>
                  ) : (
                    <GridNote>还没拍</GridNote>
                  )}
                </GridRow>
              </Pressable>
            );
          })}

          {/* 打卡那行留在最下面：多久没断、今天记了几餐。
              和上面的汇总行是一回事的两面（一个是吃了多少、一个是记了没记），
              所以中间不隔线，让它当脚注。 */}
          <GridFoot>
            已记 {day.filledSlots}/3 餐 · 连续记录 {streak} 天
          </GridFoot>
        </View>

        {counts.all > 0 ? (
          <View style={styles.toolbar}>
            <View style={styles.searchRow}>
              <TextInput
                style={styles.search}
                value={query}
                onChangeText={setQuery}
                placeholder="搜索标题或备注"
                placeholderTextColor={colors.sub}
                returnKeyType="search"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={40}
              />
              {searching ? (
                <Pressable hitSlop={10} onPress={() => setQuery('')}>
                  <Text style={styles.clearText}>清除</Text>
                </Pressable>
              ) : null}
            </View>

            {searching ? (
              <Text style={styles.resultCount}>找到 {visible.length} 条结果</Text>
            ) : null}

            <View style={styles.chipRow}>
              {FILTERS.map((item) => {
                const on = filter === item.key;
                return (
                  <Pressable
                    key={item.key}
                    style={[styles.chip, on && styles.chipOn]}
                    onPress={() => setFilter(item.key)}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>
                      {item.label} {counts[item.key]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.catFilterRow}>
              <Pressable
                style={[styles.catChip, catFilter === 'all' && styles.catChipOn]}
                onPress={() => setCatFilter('all')}
              >
                <Text style={[styles.catChipText, catFilter === 'all' && styles.catChipTextOn]}>
                  全部分类
                </Text>
              </Pressable>
              {CATEGORIES.filter((c) => c.key !== 'none').map((c) => {
                const on = catFilter === c.key;
                return (
                  <Pressable
                    key={c.key}
                    style={[styles.catChip, on && styles.catChipOn, on && { borderColor: c.color, backgroundColor: c.soft }]}
                    onPress={() => setCatFilter(c.key)}
                  >
                    <View style={[styles.catDot, { backgroundColor: c.color }]} />
                    <Text style={[styles.catChipText, on && { color: c.color }]}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.hint}>
              长按某条可以删掉 · 点「详情」能改内容、标重要 · 顶部可搜索
            </Text>
          </View>
        ) : null}

        <StateView
          state={state}
          message={message}
          onRetry={reload}
          emptyText="还没有任务。在下面输入框里写一条，按「添加」。"
        >
          <FlatList
            data={visible}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              filteredOut ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyTitle}>这里没有任务</Text>
                  <Text style={styles.emptyHint}>{emptyHintText(filter, query)}</Text>
                </View>
              ) : null
            }
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.accent}
              />
            }
          />
        </StateView>
      </View>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="想做点什么？"
          placeholderTextColor={colors.sub}
          returnKeyType="done"
          onSubmitEditing={submit}
          maxLength={80}
        />
        <Pressable
          style={[styles.addBtn, !canAdd && styles.addBtnOff]}
          onPress={submit}
          disabled={!canAdd}
        >
          <Text style={styles.addBtnText}>添加</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  body: {
    flex: 1,
  },

  /* ---------- App 标语（2026-09-29 用户要求加） ----------
     标题下面的两行注释。次要灰、字号小，一眼能看出是「说明」不是数据，
     不抢「目标 / 今日」那些主信息的视觉权重。 */
  homeTagline: {
    marginHorizontal: space.md,
    marginTop: space.sm,
    gap: 2,
  },
  tagline: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.sub,
  },

  /* ---------- 「放回原处」提示条（2026-10-02） ----------
     和餐盘页那块「这一顿改不动了」同一套色（warnSoft 底 + warnDeep 字），
     因为它是"有一笔账日子不对"，不是"出错了"。圆角和内边距沿用
     radius.md / space.md，跟下面的目标卡、今日卡是一个调子。 */
  repairBox: {
    marginHorizontal: space.md,
    marginTop: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.warnSoft,
    gap: 4,
  },
  repairTitle: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    color: colors.warnDeep,
  },
  repairText: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.warnDeep,
  },
  repairBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.sm,
  },
  repairGo: {
    paddingHorizontal: space.md,
    paddingVertical: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.warnDeep,
  },
  repairGoText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  repairSkip: {
    paddingHorizontal: space.md,
    paddingVertical: 8,
    borderRadius: radius.sm,
    // 描边而不是实底：它是"先不办"，不该跟「放回原处」一样抢眼。
    borderWidth: 1,
    borderColor: colors.warnDeep,
  },
  repairSkipText: {
    fontSize: 13,
    color: colors.warnDeep,
  },

  /* ---------- 目标 ---------- */
  // 一整条可点：点进去填年龄身高体重（app/target.tsx）。
  // 淡蓝底 + 主色字 —— 和下面白底的「今日」明确分开，而不是靠多写一行小标题。
  // 里面的三列用 styles.grid* —— 跟下面「今日」那条是同一套列宽。
  targetCard: {
    marginHorizontal: space.md,
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.accentSoft,
  },

  /* ---------- 网格（2026-09-26 晚立；2026-09-27 凌晨调过间距） ----------
     「目标」和「今日」两条、以及早/中/晚三行，全部走这一套。

     一行的结构是：**行头 + 组 + 大间隔 + 组**

         目标   总热量[ 1800]千卡    总碳水[ 235]克
         今日   总热量[  480]千卡    总碳水[  42]克
         早餐     热量[  480]千卡      碳水[  42]克
                └─ 一组 ─┘           └─ 一组 ─┘
                          └ 大间隔 ┘

     四条线是这么定住的：
       1. 行头（目标/今日/早餐）—— width 46、靠左。都 2 个字，天然对齐。
       2. **说明文字** minWidth 46 **且靠右** —— "总热量"3 个字、"热量"
          2 个字不等宽；靠右之后两者**右边缘**齐，数字永远从同一处开始，
          而"热量"后面也不会白空 20 像素。
       3. **数字格** minWidth 36（热量）/ 30（碳水）**且靠右** ——
          格子只留够 4 位 / 3 位再多一点点，位数不同的数字都往同一个右边缘堆，
          同时富余不会漏进组内。
          这里刻意**不是刚好卡死位数**：卡太死的话 4 位数的
          「总热量 1890」会粘成一个词。留一丝余量，组内就有道看得见的缝。
       4. 单位紧跟数字，只留 3 像素。

     **组与组之间的大间隔**来自 `gridSpacer` 的 `flex: 1` ——
     它是整行里唯一吃富余的东西，所以富余全落在两组正中间。
     这就是"组外间隔 > 组内间隔"的保证，不必写死像素。

     ⚠️ 组是"样式"表达出来的，**不是"嵌套"表达出来的** —— 整行的子节点一律平铺：
        `行头 Text / 说明 Text / 数字 Text / 单位 Text / (间隔 View) / 说明 / 数字 / 单位`。
        别给它们包 View：`alignItems: 'baseline'` 隔着 View 就不一定生效。
     ⚠️ 也别给组内四样（说明/数字/窄数字/单位）中的任何一个加 flex，
        否则富余会漏进组内、两组又糊在一起。
        `_grid_test.js` 第 5 组同时守着这两条。

     字号：标签 15、其余 13。tabular-nums 让数字等宽，480 和 1000 也对得齐。 */
  gridRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  // ★ 组与组之间那道大间隔。整行**唯一**的 flex:1。
  //
  // 宽度是「能撑多大撑多大，但至少 16」：
  //   360 宽的手机上，行头(46+右间距28)+第一组(~111)+第二组(~90)固定占掉约 274，
  //   剩下约 22 全给它 —— 这正是「总热量」和「总碳水」之间那道缝。
  //   它比 9/27 之前窄了：因为 9/29 把「行头→第一组」的缝拉到 2 倍，
  //   富余被挪过去一部分，这道缝自然变小（用户要的「中间稍微小一点」）。
  //   minWidth 是保底：**万一某行挤到极限（系统字体调得很大、或者屏幕更窄），
  //   宁可把内容往右挤出去一点，也绝不让「千卡」和「总碳水」贴在一起。**
  //   —— 贴在一起正是用户 9/27 凌晨提的毛病，这里就是它的最后一道防线。
  gridSpacer: {
    flex: 1,
    minWidth: 16,
  },
  // 可点的那三行（早/中/晚）上下留一点内边距：手指不至于老点偏到隔壁行。
  gridRowTap: {
    paddingVertical: 4,
  },
  // 行头那两个字（目标 / 今日 / 早餐 / 中餐 / 晚餐）。都是 2 个字，靠左即可。
  // ★ marginRight 给「行头 → 第一组」留出明显更大的缝：2026-09-29 用户要求
  //   「目标到总热量之间的空格增加到原来的 3 倍、整体往后移一点」。
  //   实测严格 3 倍（≈75px）会把「总碳水」挤出 360 屏，先降到 ≈2.6 倍（约 61px）；
  //   用户看过说还是太大，再退回 **2 倍**（这道缝 ≈ 48px，整体右移幅度减半）。
  //   这一道缝是固定像素，不挤占中间的 flex 大间隔，所以下面每一行都跟着右移、照样对齐。
  gridLabel: {
    width: 46,
    marginRight: space.lg + space.xs,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  // 组里的说明（总热量 / 总碳水 / 热量 / 碳水）。
  // 用 minWidth 而不是 width：万一哪天换成更长的词，宁可这一行宽一点，
  // 也不要被截成"总热…"。
  // ★ textAlign 'right' 是关键：让说明**贴着自己的数字** ——
  //   2 个字的"热量"靠左的话，后面会白空 20 像素。
  gridPrefix: {
    minWidth: 44,
    textAlign: 'right',
    fontSize: 13,
    color: colors.text,
  },
  // 数字格（热量列）：留够 4 位数的位子，靠右堆。
  // 用 minWidth 而不是 width —— 万一真出现 5 位数，让它自然撑开，
  // 别把数字截成"1234…"。
  // 36 而不是刚好卡死 4 位：真机实测细体 1 位数字 ≈8.5px，4 位 ≈34，
  // 36 留 2px 余量 —— 卡太死「总热量1530」会粘成一个词（9/29 真机教训）。
  gridNum: {
    minWidth: 36,
    textAlign: 'right',
    fontSize: 13,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  // 数字格（碳水列）：碳水少一位数，格子窄一点，组内更紧。
  // 30 同样留了余量（3 位 ≈26），别让「总碳水170」粘成一坨。
  gridNumNarrow: {
    minWidth: 30,
    textAlign: 'right',
    fontSize: 13,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  // 单位（千卡 / 克）。宽度随字数走，但同一列永远是同一个词，
  // 所以各行的位置天然一致。
  gridUnit: {
    marginLeft: 3,
    fontSize: 13,
    color: colors.text,
  },
  // 「还没设置」「还没拍」—— 占掉右边剩下的整块地方。
  gridNote: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
  },
  // 「目标」「今日」两行的**数字部分**：只上主色，**不加粗**。
  // ★ 2026-09-29 12:45 艾可真机截图实测：加粗在这台手机上会把字撑宽 ——
  //   「总热量」粗体 ≈51px 超过 minWidth 44，格子被撑大 → 千卡列被顶右 13px，
  //   和早/中/晚的「热量」对不上（他问「齐么？」发现的就是这个）；
  //   而且粗体把数字格填满，组内的缝全被吃掉，糊成「总热量1530千卡」。
  //   只上色后字宽回落到 41.5 < 44，所有行格子重新等宽 → 列列对齐。
  //   层次感由蓝色 + 行头加粗（gridLabelAccent）保住。
  gridAccent: {
    color: colors.accent,
  },
  // 今日合计超标警告色（2026-09-29 用户定）。
  //   黄   #EAB308：超出目标 20% 以内（2026-09-29 晚改亮：原来 #CA8A04 太深、和橘黄太像）
  //   橘黄 #EA580C：超出 20%~50%
  //   红   #DC2626：超出 50% 以上
  gridToneWarn: {
    color: '#EAB308',
  },
  gridToneOver: {
    color: '#EA580C',
  },
  gridToneDanger: {
    color: '#DC2626',
  },
  // 行头（目标 / 今日）保留加粗：两个字 ≈34px，远小于 46 的格子，
  // 加粗不改变任何列的位置。
  gridLabelAccent: {
    color: colors.accent,
    fontWeight: '600',
  },
  // "还没拍" / "还没设置"：次要灰 —— 一眼分得出哪些还空着，不用读文字。
  // 「拍」字提醒用户：这几行都要靠拍照才有数据（2026-09-29 从「还没记」改）。
  gridEmpty: {
    color: colors.sub,
    fontWeight: '400',
  },

  /* ---------- 今日三餐 ---------- */
  // 一块白色卡片固定在最上面，跟任务列表（浅蓝底）分开层次。
  // 一行一餐、纵向排，不横向拉长，手机上一屏能看全。
  mealCard: {
    marginHorizontal: space.md,
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: 6,
  },
  mealDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.line,
    marginVertical: 2,
  },
  mealFoot: {
    fontSize: 11,
    color: colors.sub,
  },
  toolbar: {
    paddingHorizontal: space.md,
    paddingTop: space.md,
    gap: space.sm,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    height: 42,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  search: {
    flex: 1,
    height: 42,
    fontSize: 14,
    color: colors.text,
  },
  clearText: {
    fontSize: 13,
    color: colors.accent,
  },
  resultCount: {
    fontSize: 12,
    color: colors.accent,
    paddingHorizontal: space.xs,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: 6,
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
  catFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  catDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  catChipOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  catChipText: {
    fontSize: 13,
    color: colors.text,
  },
  catChipTextOn: {
    color: '#FFFFFF',
  },
  hint: {
    fontSize: 11,
    color: colors.sub,
  },
  list: {
    padding: space.md,
    gap: space.sm,
  },
  emptyBox: {
    paddingTop: space.xl,
    paddingHorizontal: space.md,
    alignItems: 'center',
    gap: space.sm,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  emptyHint: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.sub,
    textAlign: 'center',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
  },
  input: {
    flex: 1,
    height: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    fontSize: 15,
    color: colors.text,
  },
  addBtn: {
    height: 44,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnOff: {
    backgroundColor: colors.line,
  },
  addBtnText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#FFFFFF',
  },
});
