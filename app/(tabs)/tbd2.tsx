import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GestureResponderEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { colors, radius, space } from '../../lib/theme';
import { readLog, slotLabel, streakDays, summarizeDay, SLOT_KEYS } from '../../lib/meal/log';
import type { MealLogEntry } from '../../lib/meal/log';
import { toISODate, today } from '../../lib/date';
// 汇总那几行用的网格：首页「今日三餐」和这里**共用同一份**（components/NumRow.tsx）。
import { GridDivider, GridFoot, GridLabel, GridNote, GridRow, GridSpacer, NumCell } from '../../components/NumRow';

// 星期标题：周日开始（日 一 二 三 四 五 六），和中国手机系统日历一致。
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

// "2026-09-29" → 那个月的第 1 天 Date 对象（切月用）。
function monthOf(iso: string): Date {
  const [y, m] = iso.split('-').map(Number);
  return new Date(y, m - 1, 1);
}

// "2026-09-29" → 「9.29」，当天板块最上面那个标题（用户 2026-10-01 定：
// 首页那块写「今日」，这里换成数字日期，一眼看出看的是哪一天）。
function dotLabel(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}.${d}`;
}

export default function RecordsScreen() {
  const router = useRouter();
  const [entries, setEntries] = useState<MealLogEntry[]>([]);
  // 当前显示的月份（只用到 年/月）。默认本月。
  const [month, setMonth] = useState(() => new Date());
  // 选中的日期（ISO 串）。默认今天。
  const [selected, setSelected] = useState<string>(today());
  // 记录手指按下的 x 坐标，用来判断左右滑的方向。
  const touchX = useRef<number | null>(null);

  // 进来先读一次账本。读不到就是空数组，页面显示「暂无记录」，不会崩。
  // ★ 2026-10-01 改：读完顺手把月历**定位到最近有记录的那个月、选中那天**。
  //   之前写死打开「本月(十月)」，而用户最近几天的记录都在**九月最后几天**
  //   （今天是 10 月 1 日 → 前五天就是 9/26~9/30），一打开月历一个蓝点都没有，
  //   看起来像记录丢了、也点不进去。现在：今天有记录就留今天，
  //   今天没记录就直接落到最近记过那天 —— 一进页面就有内容可调出来。
  // 补拍完从「那天详情」退回来时，月历要跟着长出一个蓝点 ——
  // 不重读一次的话，这一页还停在旧账上，看着像刚记的那一顿没进去（其实进去了）。
  // 用 useFocusEffect（不是再写一个 useEffect）：这页每次获得焦点都会刷一次，
  // 但只在真正重新拿到焦点时才跑，不在每次渲染时白刷。
  useFocusEffect(useCallback(() => {
    void readLog().then((list) => {
      setEntries(list);
    });
  }, []));

  useEffect(() => {
    readLog().then((list) => {
      setEntries(list);
      if (list.length === 0) return;
      const days = new Set(list.map((e) => e.date));
      const t = today();
      if (days.has(t)) return; // 今天已经记了，留在本月今天
      const newest = list.reduce((a, e) => (e.date > a ? e.date : a), list[0].date);
      setSelected(newest);
      setMonth(monthOf(newest));
    });
  }, []);

  // 有记录的日期集合 —— 月历上这些天画蓝点。
  const recordDays = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) s.add(e.date);
    return s;
  }, [entries]);

  // 跳到某天：选中它，同时把月历切到它所在的月份（不然点九月那天、
  // 月历还停在十月，会以为没反应）。
  const jumpTo = (iso: string) => {
    setSelected(iso);
    setMonth(monthOf(iso));
  };

  // 点当天那块 → 那一天的详情页（含菜单，再点某一餐能看到照片）。
  const openDay = () => {
    router.push({ pathname: '/day', params: { d: selected } });
  };

  const year = month.getFullYear();
  const m = month.getMonth();
  const firstWeekday = new Date(year, m, 1).getDay(); // 0=周日
  const daysInMonth = new Date(year, m + 1, 0).getDate();
  // 拼出 7 列网格：只在**前面**补空位（让 1 号落在正确的星期上）。
  // ⚠️ 尾部**要**补空位（2026-10-03 又改回来的原因）：
  //    上一版「尾巴不补」是修「日历底下多一行留白」，但补法当时补错了——
  //    不是在最后一行补到 7 个，而是任由最后一行少于 7 个。
  //    格子是 flex:1 平分整行的，最后一行 4 个格子每人分到 1/4 宽（别的行是 1/7），
  //    结果就是 27/28/29/30 不对齐星期列、整行摊满（2026-10-02 用户截图提的）。
  //    正确做法：**最后一行补 null 到 7 个**。空格子什么都不画，
  //    行的高度由有日期的格子撑起来，不会产生「多一行留白」——
  //    因为那一行本来就有日期，只是补齐了它右边空着的列。
  //    只有当月最后一天恰好是周六时，最后一行正好满 7 个，也不用补。
  // ⚠️ 这里**提前切成「周」**而不是把天数摊平后丢给 flexWrap（2026-10-02 修的 bug）：
  //    摊平 + flexWrap 时，7 个格子各写 width:'1/7'，布局引擎算宽度有浮点误差，
  //    累计到第 7 个会**刚好超出去** → 第 7 个被挤到下一行。
  //    十月就是这么错的：第一行只剩 1、2，3 跑到了第二行最左（「日」那一列），
  //    「六」那一列整列空着 —— 用户看到「最右边一栏是空白」就是这个。
  //    切成周以后，每一周都是一个**固定 7 格**的横排，行与行自己断开，
  //    不依赖任何百分比累加，也就不会再错行。
  const weeks: (string | null)[][] = [];
  {
    let row: (string | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) row.push(null); // 让 1 号落对星期
    for (let d = 1; d <= daysInMonth; d++) {
      row.push(toISODate(new Date(year, m, d)));
      if (row.length === 7) {
        weeks.push(row);
        row = [];
      }
    }
    if (row.length > 0) {
      while (row.length < 7) row.push(null); // 补齐星期列，格子留空但不错位
      weeks.push(row);
    }
  }

  // 选中那天的汇总（早/中/晚各自的碳水、热量、食物名）。
  const day = useMemo(() => summarizeDay(entries, selected), [entries, selected]);
  // 连续记录了多少天（首页那块的脚注用的同一套算法，见 lib/meal/log.ts）。
  const streak = useMemo(() => streakDays(entries, selected), [entries, selected]);

  // 切月。delta=+1 下个月，−1 上个月。
  const goMonth = (delta: number) => {
    setMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  // 左右滑：右滑(手指往右, dx>0)→上个月；左滑→下个月（和 iOS 日历一致）。
  const onTouchStart = (e: GestureResponderEvent) => {
    touchX.current = e.nativeEvent.pageX;
  };
  const onTouchEnd = (e: GestureResponderEvent) => {
    if (touchX.current == null) return;
    const dx = e.nativeEvent.pageX - touchX.current;
    if (dx > 60) goMonth(-1);
    else if (dx < -60) goMonth(1);
    touchX.current = null;
  };

  const isToday = (iso: string) => iso === today();

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollPad}>
      {/* ===== 月历卡片 ===== */}
      <View style={styles.calCard}>
        {/* 月份行：← 月份 → ＋ 最右边「今天」按钮（2026-10-01 把「今天」从
            原来那行说明里挪到这里 —— 用户要的是最上面、和月份同一行的最右边，
            说明文字那一行整个去掉，界面更干净）。

            ★ 箭头用 Ionicons 的尖括号图标，不用 ‹ › 这两个字符（2026-10-01 修）：
              那两个字符**在字体里的上下位置本来就不一样高**，右边的看着偏低 ——
              用户一眼就看出来了。图标是矢量图形，左右两颗尺寸、位置严格对称，
              不管换什么手机、什么字体都不会歪。
              按钮也收窄了（36 → 22），两颗箭头贴着月份走，不再散在两端。 */}
        <View style={styles.calHeader}>
          <Pressable style={styles.arrowBtn} onPress={() => goMonth(-1)} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={colors.accent} />
          </Pressable>
          <View style={styles.monthWrap}>
            <Text style={styles.monthLabel}>{year}年{m + 1}月</Text>
          </View>
          <Pressable style={styles.arrowBtn} onPress={() => goMonth(1)} hitSlop={8}>
            <Ionicons name="chevron-forward" size={22} color={colors.accent} />
          </Pressable>
          <Pressable style={styles.todayBtn} onPress={() => jumpTo(today())} hitSlop={6}>
            <Text style={styles.todayBtnText}>今天</Text>
          </Pressable>
        </View>

        {/* 星期标题行 */}
        <View style={styles.weekRow}>
          {WEEK.map((w) => (
            <Text key={w} style={styles.weekCell}>
              {w}
            </Text>
          ))}
        </View>

        {/* 日期网格（包一层接收左右滑） */}
        <View style={styles.grid} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {weeks.map((week, wi) => (
            <View key={`w${wi}`} style={styles.week}>
              {week.map((iso, di) => {
                if (!iso) {
                  return <View key={`e${wi}-${di}`} style={styles.dayCell} />;
                }
                const d = Number(iso.slice(8, 10));
                const on = iso === selected;
                const marked = recordDays.has(iso);
                return (
                  <Pressable
                    key={iso}
                    style={[styles.dayCell, on && styles.dayCellOn, isToday(iso) && !on && styles.dayCellToday]}
                    onPress={() => jumpTo(iso)}
                  >
                    <Text style={[styles.dayNum, on && styles.dayNumOn]}>{d}</Text>
                    {/* 有记录的天：底下画一个蓝点 */}
                    {marked && <View style={styles.dot} />}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </View>

      {/* ===== 选中那天的三餐 =====
          做成和首页「今天」那块一模一样的样子（2026-10-01 用户定）：
          最上面一行是**数字日期**（9.29 而不是「今日」），跟着就是总热量 / 总碳水，
          再往下是早 / 中 / 晚三行各自的「热量 千卡 · 碳水 克」。
          整块都能点 —— 点进去是那一天的**完整详情（含菜单）**，
          在那儿再点某一餐，就能看到那一餐的照片（见 app/day.tsx）。 */}
      <Pressable
        style={styles.detail}
        onPress={openDay}
        accessibilityRole="button"
        accessibilityLabel={`看 ${dotLabel(selected)} 那一天的完整记录`}
      >
        {/* ★ 这一整块和首页「今日三餐」那张卡片用的是**同一套网格**
            （components/NumRow.tsx，不是各写一份）：
            行头 + 「说明 / 数字 / 单位」的三段一组，组与组之间靠 flex 大间隔。
            所以这里的「总热量 / 总碳水 / 热量 / 碳水」四列，
            和首页下面那四列**落在完全相同的竖线上** —— 上下对照着看不用左右找。
            用户 2026-10-01 定：「记录页第二块要像首页里面同样的排列」。 */}
        <GridRow>
          <GridLabel accent>{dotLabel(selected)}</GridLabel>
          <NumCell prefix="总热量" value={day.totalCalories} unit="千卡" accent />
          <GridSpacer />
          <NumCell prefix="总碳水" value={day.totalCarb} unit="克" accent narrow />
        </GridRow>

        <GridDivider />

        {SLOT_KEYS.map((k) => {
          const s = day.slots[k];
          const has = s.count > 0;
          const label = slotLabel(k);
          return (
            <GridRow tap key={k}>
              <GridLabel>{label}</GridLabel>
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
          );
        })}

        <GridFoot>已记 {day.filledSlots}/3 餐 · 连续记录 {streak} 天</GridFoot>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  // 上下间距整体收紧（用户 2026-10-01 定「紧凑一些」）：
  // 卡片内边距 16 → 8、星期行与日期之间 4 → 2。
  //
  // ⚠️ 左右两端**不跟着收成 8**：下面那张「当天汇总」卡片要跟首页「今日三餐」
  // 用同样的排法，两张卡必须同宽 —— 卡片一宽一窄，最右那列（「克」）就会
  // 贴着各自的内边距走，两页看着就对不齐（2026-10-01 实测差 16px）。
  // 所以这里左右留 space.md（16），和首页的 mealCard 一样。
  scrollPad: {
    paddingLeft: space.md,
    paddingRight: space.md,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    gap: space.sm,
    // 内容没填满一屏时把剩下的高度**分给下面的卡**（配 detail 的 flexGrow 用）。
    // 不写这句，最后一张卡底下就会露出一大片浅灰底 —— 就是用户 2026-10-02
    // 说的「最下面那个留白」。
    flexGrow: 1,
  },
  // 月历卡片。上下内边距收成 6（左右保留 8：要和首页的卡片同一条边）。
  // 用户 2026-10-02 要「整个第一部分上下缩小一点」，省下来的高度正好给下面
  // 他要加的那一项腾位置。
  calCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingTop: 6,
    paddingBottom: 6,
    paddingLeft: space.sm,
    paddingRight: space.sm,
  },
  // 「今天」小按钮（2026-10-01 起放在月份行最右边）
  todayBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.accentSoft,
  },
  todayBtnText: {
    fontSize: 12,
    color: colors.accent,
    fontWeight: '600',
  },
  calHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: space.xs,
  },
  // 月份标题占满中间剩下的宽度、文字居中 —— 这样左右两个箭头贴边、
  // 「今天」在最右边，月份本身仍在整行正中。
  monthWrap: {
    flex: 1,
    alignItems: 'center',
  },
  monthLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  // 窄一档（36 → 22）：图标本身就 22 宽，按钮再宽就是白占地方，
  // 两颗箭头会被推到卡片两端、离月份老远（用户嫌的就是这个）。
  arrowBtn: {
    width: 22,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  weekCell: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    color: colors.sub,
  },
  // 周与周之间竖直排（每周自己是个横排，见 styles.week）。
  // 不用 flexWrap —— 见上面 weeks 那段注释里的换行 bug。
  grid: {
    flexDirection: 'column',
  },
  week: {
    flexDirection: 'row',
  },
  dayCell: {
    flex: 1, // 一周 7 格平分整行宽度 → 和上面「日一二三四五六」逐列对齐
    // ⚠️ 不要写 aspectRatio（2026-10-03 删掉）：上一版写了 0.82，注释说"扁一格"，
    //    但 RN 里 aspectRatio 是 宽÷高，0.82 = 高是宽的 1.22 倍 → 格子全变竖条，
    //    整个日历被撑得稀稀拉拉（2026-10-02 用户截图提的）。
    // ⚠️ 别再往下压了（2026-10-03 血泪）：
    //    同一天里我连着收了两次行距（第一次去掉 paddingVertical，
    //    第二次把 dayNum 的 lineHeight 从 ~19 压到 16），压完整个日历稀疏感没了、
    //    格子挤成一团，用户一看就说太紧。
    //    现在按用户定的 +50% 往回补：lineHeight 16 → 24（见 styles.dayNum）。
    //    格子高度 = dayNum 行高（含 dot 的天再 +9），改这里之前先算一眼。
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  dayCellOn: {
    backgroundColor: colors.accentSoft,
  },
  dayCellToday: {
    borderWidth: 1,
    borderColor: colors.accent,
  },
  dayNum: {
    fontSize: 14,
    // 16 → 24（用户 2026-10-03 定「加大 50%」）：抵消前面那次过度收紧。
    // 24 大约回到两次收紧之前的高度，别再往上加了。
    lineHeight: 24,
    color: colors.text,
  },
  dayNumOn: {
    color: colors.accent,
    fontWeight: '700',
  },
  // 有记录的天：底部蓝点（在日期格子内、数字下方）
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
    marginTop: 3,
  },
  /* ---------- 当天那块（和首页「今日三餐」同一套排法）----------
     行结构、列宽、分组间隔**全部来自 components/NumRow.tsx**，
     这里只留卡片本身的白底和圆角 —— 一改就两边不一致，所以别在这里调数字。 */
  detail: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.md,
    gap: 2,
    // 铺到底：内容不满一屏时，这张卡吃掉剩下的高度，
    // 底部不再留一片浅灰（2026-10-02 用户要的「最下面那个留白不要」）。
    // 下面再加东西也不怕 —— 内容一超一屏，这里就自动退回内容本来的高度。
    flexGrow: 1,
  },
});
