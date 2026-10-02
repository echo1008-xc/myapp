import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { colors, radius, space } from '../lib/theme';
import { canAddEntry, readLog, slotLabel, summarizeDay, SLOT_KEYS } from '../lib/meal/log';
import type { MealLogEntry, MealSlot } from '../lib/meal/log';

// 星期标题：周日开始（日 一 二 三 四 五 六），和中国手机系统日历一致。
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

// "2026-09-29" → 「9月29日 周二」，本页最上面那行大标题。
function title(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = WEEK[new Date(y, m - 1, d).getDay()];
  return `${m}月${d}日 周${wd}`;
}

// 点某一餐 → 那一张照片和那一次的分析。
//
// ★ 为什么直接跳 /meal（就是底部「餐前拍」那个页面）而不是另做一个：
//   它本来就有「从首页点进来回看」这条路（带 entry 参数），
//   能把当时那张照片、逐项菜单、总评原样摆出来 —— 不复刻一遍，少一处会跑偏的副本。
//
// ⚠️ 多带一个 t（点下去的这一刻）：不带它的话，"点进去 → 拍张新的 → 再点同一餐"
//    地址里的 entry 没变，React 就认为参数没变化、不会重新还原。
//
// ★ 照片**不存本页、也不存 App 里**：账本只记它**存在相册里的位置**（imageUri），
//    看的时候由 /meal 那一页直接去取相册里那一份（见 lib/meal/album.ts）。
//    App 自己不留照片副本，所以也就不占 App 的空间、换手机也丢不了。
export default function DayScreen() {
  // 从记录页点进来时会带上 d = 那一天的日期（"2026-09-29"）。
  // 没带就当作今天，免得打开是空白一片。
  const params = useLocalSearchParams<{ d?: string }>();
  const date = typeof params.d === 'string' && params.d ? params.d : '';
  const router = useRouter();
  const [entries, setEntries] = useState<MealLogEntry[]>([]);

  // ★ 补拍完退回来时，这页要**重新读一次账本**：不然刚补进去的那一餐
  //   还挂着"补拍这一餐"，用户再点一下就把自己的记录顶掉了，还说不清。
  const reload = useCallback(() => {
    void readLog().then(setEntries);
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  useFocusEffect(reload);

  const day = date ? summarizeDay(entries, date) : null;

  const openMeal = (id: string) => {
    router.push({ pathname: '/meal', params: { entry: id, t: String(Date.now()) } });
  };

  // ---------- 补拍（2026-10-02，用户原话）----------
  // 「在历史记录的最后一餐的**后一餐**开始，应该可以补拍。
  //   比如 9 月 30 号晚上是最后，那么 10 月 1 号的早餐现在应该可以补拍录入。」
  //
  // 能不能补，不在这儿拍板 —— 规矩写在 lib/meal/log.ts 的 canAddEntry 里
  // （新记的一顿只能落在账本最晚那一顿之后），这里只问它一句、照它的话显不显示。
  // 所以这一页**只摆两种块**：已经记了的那一餐，和**此刻补得进去**的那一餐。
  // 补不进去的（比如 9/29 那一早，账本最晚已经是它后面的晚餐了）连块都不画，
  // 免得看见一个点不动的东西。
  const backfillable = SLOT_KEYS.filter(
    (k) => day && day.slots[k].count === 0 && canAddEntry(entries, date, k).ok,
  );

  const backfill = (slot: MealSlot) => {
    // d = 补到哪一天（就是这一页的这一天），preset = 补哪一餐。
    // 餐盘页认得这两个参数（见 meal.tsx 里那段），拍完直接归这一格，不用再选。
    router.push({ pathname: '/meal', params: { d: date, preset: slot, pt: String(Date.now()) } });
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.pad}>
      {day ? (
        <>
          {/* ---------- 这天一共吃了什么（一行两个大数）---------- */}
          <View style={styles.totalCard}>
            <Text style={styles.totalDate}>{title(date)}</Text>
            <View style={styles.totalRow}>
              <View style={styles.totalCell}>
                <Text style={styles.totalNum}>{day.totalCalories}</Text>
                <Text style={styles.totalUnit}>总热量 千卡</Text>
              </View>
              <View style={styles.totalCell}>
                <Text style={styles.totalNum}>{day.totalCarb}</Text>
                <Text style={styles.totalUnit}>总碳水 克</Text>
              </View>
            </View>
            <Text style={styles.totalFoot}>已记 {day.filledSlots}/3 餐</Text>
          </View>

          {/* ---------- 菜单：早 / 中 / 晚各一整块 ----------
              每块都能点，点进去就是那一餐当时拍的照片和完整分析。
              没记的那一餐不画空块 —— 摆一排灰扑扑的空卡片比不摆更闹。 */}
          {SLOT_KEYS.map((k) => {
            const s = day.slots[k];
            // 已经记了 → 摆那一餐（下面那块）；没记 → 只有**补得进去**才摆一块
            // 「补拍这一餐」，补不进去的就什么都不摆（规矩见 canAddEntry）。
            if (s.count === 0) {
              if (!backfillable.includes(k)) return null;
              return (
                <Pressable style={styles.mealCard} key={k} onPress={() => backfill(k)}>
                  <View style={styles.mealHead}>
                    <Text style={styles.mealTitle}>{slotLabel(k)}</Text>
                    <Text style={styles.mealSum}>还没记</Text>
                  </View>
                  <Text style={styles.tapHint}>补拍这一餐</Text>
                </Pressable>
              );
            }
            const latest = s.entries[s.entries.length - 1];
            return (
              <Pressable style={styles.mealCard} key={k} onPress={() => openMeal(latest.id)}>
                <View style={styles.mealHead}>
                  <Text style={styles.mealTitle}>{slotLabel(k)}</Text>
                  <Text style={styles.mealSum}>
                    {s.calories} 千卡 · {s.carb} 克碳水
                  </Text>
                </View>

                {/* 逐项菜单。老记录没有逐项明细（items 是后加的字段），
                    那就退回只列名字，不留一块空白让人对着猜。 */}
                {s.entries.map((e) =>
                  (e.items && e.items.length > 0 ? e.items : []).map((it, i) => (
                    <View style={styles.itemRow} key={`${e.id}-${i}`}>
                      <Text style={styles.itemName} numberOfLines={2}>
                        {it.name}
                      </Text>
                      <Text style={styles.itemMeta} numberOfLines={1}>
                        {it.grams > 0 ? `${it.grams} 克 · ` : ''}
                        {it.calories} 千卡 · 碳水 {it.carb} 克
                      </Text>
                    </View>
                  )),
                )}

                {latest.summary ? (
                  <Text style={styles.summary}>{latest.summary}</Text>
                ) : null}
                <Text style={styles.tapHint}>点这一餐看当时的照片</Text>
              </Pressable>
            );
          })}

          {day.filledSlots === 0 && backfillable.length === 0 ? (
            <Text style={styles.empty}>这一天还没有记录。</Text>
          ) : null}

          <Text style={styles.note}>
            照片都存在手机相册里（不在本 App 里），点某一餐就能看到当时拍的那张。
          </Text>
        </>
      ) : (
        <Text style={styles.empty}>没有指定要看哪一天。</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  pad: {
    padding: space.md,
    gap: space.sm,
    paddingBottom: space.xl,
  },
  // 合计那块：淡蓝底（和餐盘页「本餐合计」同一块底），日期 + 两个大数。
  totalCard: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
  },
  totalDate: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.accent,
  },
  totalRow: {
    flexDirection: 'row',
  },
  totalCell: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  totalNum: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.accent,
    fontVariant: ['tabular-nums'],
  },
  totalUnit: {
    fontSize: 11,
    color: colors.sub,
  },
  totalFoot: {
    fontSize: 11,
    color: colors.sub,
  },
  // 每一餐一块，整块可点。
  mealCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
  },
  mealHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  mealTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  mealSum: {
    fontSize: 12,
    color: colors.sub,
    fontVariant: ['tabular-nums'],
  },
  // 菜单里的一项：名字两行能放下，右边那条小字一行（份量 · 千卡 · 碳水）。
  itemRow: {
    gap: 2,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  itemName: {
    fontSize: 14,
    color: colors.text,
  },
  itemMeta: {
    fontSize: 12,
    color: colors.sub,
    fontVariant: ['tabular-nums'],
  },
  summary: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.sub,
  },
  // 这一块是能点的，但只有一行小字说明它点开是什么 ——
  // 不给图标、不给箭头，免得整块界面变成一排按钮。
  tapHint: {
    fontSize: 11,
    color: colors.accent,
  },
  empty: {
    fontSize: 14,
    color: colors.sub,
  },
  note: {
    fontSize: 11,
    lineHeight: 17,
    color: colors.sub,
    marginTop: space.xs,
  },
});
