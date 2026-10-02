import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  ACTIVITIES,
  DEFAULT_PROFILE,
  GOALS,
  MEAL_CAL_SPLIT,
  MIN_CARB,
  SEXES,
  dailyTarget,
  mealCarbSplit,
  minCalories,
  readProfile,
  sanitizeProfile,
  saveProfile,
} from '../lib/profile';
import type { ActivityKey, GoalKey, Profile, Sex } from '../lib/profile';
import { colors, radius, space } from '../lib/theme';

// 「我的目标」详情页（2026-09-26 新建，2026-09-29 收紧 + 加三餐拆分 + 加安全下限；
// 2026-09-30 重构：板块重排 + 可改区统一浅底）。
// 首页最上面那条点进来的就是这一页：填年龄、身高、体重、活动量、目标，
// 当场算出每天该吃多少热量、多少碳水，并拆成早/午/晚三餐。
//
// ★ 2026-09-30 板块顺序（用户定）：
//   ① 最上部 = 基本情况（个人概况）：这一页唯一「能输入、能改」的地方，
//      所有选项 / 输入框统一铺浅蓝底（accentSoft）—— 和照片分析页的
//      「带浅色底 = 可点改」是同一套语言，一眼就知道哪能改。
//   ② 中部 = 每天建议（两张大数字 + 三餐表）：结论放中间，改完概况当场就变。
//   ③ 安全下限、免责声明 放在最底部。
//
// 为什么**没有保存按钮**：这个 App 里改克数也是改完当场生效（见 meal.tsx），
// 保持一致 —— 动一下就写一次，返回首页那行数字已经变了。
// 用户要的是「三分钟内看到屏幕上的变化」，多一个按钮就多一次"我到底存上没存上"的犹豫。
//
// 为什么数字框要用单独的文本 state：用户可能把年龄删空、或者只按了个「1」。
// 那一刻数字是无效的，但**框里必须留住他打的字**（受控组件不能自己跳回去），
// 所以文本和数字分开管：文本照原样显示，数字有效了才算。

export default function TargetScreen() {
  const [p, setP] = useState<Profile>(DEFAULT_PROFILE);
  const [ageTxt, setAgeTxt] = useState(String(DEFAULT_PROFILE.age));
  const [heightTxt, setHeightTxt] = useState(String(DEFAULT_PROFILE.heightCm));
  const [weightTxt, setWeightTxt] = useState(String(DEFAULT_PROFILE.weightKg));

  // 进页面先读存档；没存过就用默认值把框填好 —— 用户一进来就能看见一组数字，
  // 改哪个、哪行数当场变，比对着空框发呆清楚。
  useEffect(() => {
    void (async () => {
      const saved = await readProfile();
      const use = saved ?? DEFAULT_PROFILE;
      setP(use);
      setAgeTxt(String(use.age));
      setHeightTxt(String(use.heightCm));
      setWeightTxt(String(use.weightKg));
    })();
  }, []);

  // 改一项就存一次。存之前统一过一遍 sanitizeProfile：超范围的数字会被裁到边界，
  // 所以就算用户把体重打成 9999，也只会算出一个边界值，不会崩、不会算出负数。
  const update = useCallback((patch: Partial<Profile>) => {
    setP((prev) => {
      const next = sanitizeProfile({ ...prev, ...patch });
      void saveProfile(next);
      return next;
    });
  }, []);

  // 文本框共用一套：先照原样显示，能解析成大于 0 的整数才写进档案。
  const onNumber = useCallback(
    (field: 'age' | 'heightCm' | 'weightKg', setter: (t: string) => void) => (t: string) => {
      setter(t);
      const n = parseInt(t.replace(/[^0-9]/g, ''), 10);
      if (isFinite(n) && n > 0) {
        update({ [field]: n } as Partial<Profile>);
      }
    },
    [update],
  );

  const target = useMemo(() => dailyTarget(p), [p]);

  const floorCal = minCalories(p.sex);
  // 控糖模式：碳水三餐比例和热量不同（早餐压低），给一句提醒。
  const sugarMode = p.goal === 'sugar';
  // 三餐占全天的比例：能量统一 30/40/30；碳水控糖时 25/40/35，其余跟着能量走。
  // 三餐标签：和首页一致，竖着一餐一行（早餐 / 中餐 / 晚餐）。
  const MEAL_LABELS = ['早餐', '中餐', '晚餐'];
  const calSplit = MEAL_CAL_SPLIT;
  const carbSplit = mealCarbSplit(p.goal);
  const calVals = [
    target.meal.breakfast.calories,
    target.meal.lunch.calories,
    target.meal.dinner.calories,
  ];
  const carbVals = [
    target.meal.breakfast.carb,
    target.meal.lunch.carb,
    target.meal.dinner.carb,
  ];
  const calPct = [
    Math.round(calSplit[0] * 100),
    Math.round(calSplit[1] * 100),
    Math.round(calSplit[2] * 100),
  ];
  const carbPct = [
    Math.round(carbSplit[0] * 100),
    Math.round(carbSplit[1] * 100),
    Math.round(carbSplit[2] * 100),
  ];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* ---------- 基本情况（个人概况，2026-09-30 移到最上部）----------
          这一块是整页唯一「能输入 / 能改」的地方。
          统一规则（和照片分析页一致）：凡是铺了浅蓝底（accentSoft）的一块，
          都能点 / 能改 —— 性别、运动、目标是点选；年龄、身高、体重是输入。
          没铺底的是说明文字，不是可改项。 */}
      <View style={styles.card}>
        <View style={styles.profileRow}>
          {/* 左侧竖排标题「个人概况」+ 竖线，右侧四行等间距。 */}
          <View style={styles.sideLabel}>
            {['个', '人', '概', '况'].map((c) => (
              <Text key={c} style={styles.sideChar}>{c}</Text>
            ))}
          </View>
          <View style={styles.sideDivider} />
          <View style={styles.profileContent}>
            {/* 性别 + 年龄 放一行 */}
        <View style={styles.twoCol}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>性别</Text>
            <View style={styles.chips}>
              {SEXES.map((s) => (
                <Chip
                  key={s.key}
                  label={s.label}
                  grow
                  on={p.sex === s.key}
                  onPress={() => update({ sex: s.key as Sex })}
                />
              ))}
            </View>
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>年龄</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                value={ageTxt}
                onChangeText={onNumber('age', setAgeTxt)}
                keyboardType="number-pad"
                maxLength={3}
                placeholder="岁"
                placeholderTextColor={colors.sub}
              />
              <Text style={styles.unit}>岁</Text>
            </View>
          </View>
        </View>

        {/* 身高 + 体重 放一行 */}
        <View style={styles.twoCol}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>身高</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                value={heightTxt}
                onChangeText={onNumber('heightCm', setHeightTxt)}
                keyboardType="number-pad"
                maxLength={3}
                placeholder="厘米"
                placeholderTextColor={colors.sub}
              />
              <Text style={styles.unit}>厘米</Text>
            </View>
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>体重</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                value={weightTxt}
                onChangeText={onNumber('weightKg', setWeightTxt)}
                keyboardType="number-pad"
                maxLength={3}
                placeholder="公斤"
                placeholderTextColor={colors.sub}
              />
              <Text style={styles.unit}>公斤</Text>
            </View>
          </View>
        </View>

        <View style={styles.row}>
          <Text style={styles.label} numberOfLines={1} maxFontSizeMultiplier={FONT_CAP}>运动</Text>
          <View style={styles.chipRow}>
            {ACTIVITIES.map((a) => (
              <Chip
                key={a.key}
                label={a.label}
                grow
                on={p.activity === a.key}
                onPress={() => update({ activity: a.key as ActivityKey })}
              />
            ))}
          </View>
        </View>

        <View style={styles.row}>
          <Text style={styles.label} numberOfLines={1} maxFontSizeMultiplier={FONT_CAP}>目标</Text>
          <View style={styles.chipRow}>
            {GOALS.map((g) => (
              <Chip
                key={g.key}
                label={g.label}
                grow
                on={p.goal === g.key}
                onPress={() => update({ goal: g.key as GoalKey })}
              />
            ))}
          </View>
        </View>
          </View>
        </View>
      </View>

      {/* ---------- 每天建议（2026-09-30 移到中部：这是整页的结论，改完概况当场就变）----------
          内部疏密反差：上面两张大数字很「密」地并排，下面三餐表整体放大、行高拉高，
          显得「疏」—— 一密一疏，结论和明细谁是谁一眼分清。 */}
      <View style={styles.resultCard}>
        {/* 「每天建议」和两张大数字并排同一行：标签在左、数字填满右边。 */}
        <View style={styles.resultHead}>
          <Text style={styles.resultLabel}>每天建议</Text>
          <View style={[styles.resultRow, { flex: 1 }]}>
            <View style={styles.resultCell}>
              <Text style={styles.resultNum}>{target.calories}</Text>
              <Text style={styles.resultUnit}>千卡</Text>
            </View>
            <View style={styles.resultCell}>
              <Text style={styles.resultNum}>{target.carb}</Text>
              <Text style={styles.resultUnit}>克碳水</Text>
            </View>
          </View>
        </View>

        {/* 三餐分配：一张表。左列 早/中/晚；每个营养素一列"数值"紧跟一列"占比"，
            抬头只要「占比」两字（数值列已标热量/碳水，不重复）。
            所有格子数字**居中**；每格 numberOfLines=1 —— 不换行（单位用更小的字跟在后面，
            所以「热量(千卡)」整串还是横着排在一行）。
            能量统一 30/40/30；碳水控糖时 25/40/35。
            ★ 2026-09-30：相对放大 —— 字号、行高、列宽都比原来大一圈，
            让它在这页里更"重"、更好读（它不是可改项，所以不铺浅底）。 */}
        <View style={styles.mealBlock}>
          <View style={styles.table}>
            <View style={[styles.tr, styles.trHead]}>
              <Text style={[styles.tc, styles.tcName, styles.th]} numberOfLines={1}>餐次</Text>
              <Text style={[styles.tc, styles.tcNum, styles.th]} numberOfLines={1}>热量<Text style={styles.thUnit}>(千卡)</Text></Text>
              <Text style={[styles.tc, styles.tcPct, styles.th]} numberOfLines={1}>占比</Text>
              <Text style={[styles.tc, styles.tcNum, styles.tcNum2, styles.th]} numberOfLines={1}>碳水<Text style={styles.thUnit}>(克)</Text></Text>
              <Text style={[styles.tc, styles.tcPct, styles.th]} numberOfLines={1}>占比</Text>
            </View>
            {[0, 1, 2].map((i) => (
              <View style={styles.tr} key={i}>
                <Text style={[styles.tc, styles.tcName, styles.td, styles.tdName]} numberOfLines={1}>{MEAL_LABELS[i]}</Text>
                <Text style={[styles.tc, styles.tcNum, styles.td]} numberOfLines={1}>{calVals[i]}</Text>
                <Text style={[styles.tc, styles.tcPct, styles.td]} numberOfLines={1}>{calPct[i]}%</Text>
                <Text style={[styles.tc, styles.tcNum, styles.tcNum2, styles.td]} numberOfLines={1}>{carbVals[i]}</Text>
                <Text style={[styles.tc, styles.tcPct, styles.td]} numberOfLines={1}>{carbPct[i]}%</Text>
              </View>
            ))}
          </View>
          {sugarMode && (
            <Text style={styles.mealTip}>控糖模式：早餐碳水占比压到 25%（其余跟着能量走 40/35），因为早上血糖最难控。</Text>
          )}
        </View>
      </View>

      {/* ---------- 两条安全下限（低于反而伤身，必须列出来）---------- */}
      <View style={styles.floorCard}>
        <Text style={styles.floorTitle}>两条安全下限（低于反而伤身）</Text>
        <Text style={styles.floorLine}>
          • 热量不低于 <Text style={styles.floorKey}>{floorCal}</Text> 千卡/天：再低会压低代谢、丢肌肉、易反弹。
          {p.sex === 'male' ? '（男性比女性高 300，是通用口径。）' : ''}
        </Text>
        <Text style={styles.floorLine}>
          • 碳水不低于 <Text style={styles.floorKey}>{MIN_CARB}</Text> 克/天：再低大脑缺糖、逼出酮症，控糖更不稳。
        </Text>
      </View>

      {/* 这句必须留：给的是公式估算值，个体差异大，而且有些病必须听医生的。
          删掉它这个功能就成了"冒充医嘱"，不能删。 */}
      <Text style={styles.disclaimer}>
        按身高体重和活动量估算，个体差异可能有 10% 上下。
        有糖尿病、肾病或正在怀孕，请以医生给的方案为准。
      </Text>
    </ScrollView>
  );
}

// 一个可选项。选中 = 实色蓝底白字；没选 = 浅蓝底（accentSoft）灰字 ——
// 浅蓝底和照片分析页"能改的那块"是同一种颜色，所以一眼就知道这仨能点。
// 不用对勾、不加"已选"文字 —— 颜色本身就是答案。
function Chip({ label, on, onPress, grow }: { label: string; on: boolean; onPress: () => void; grow?: boolean }) {
  return (
    <Pressable
      style={[styles.chip, grow && styles.chipGrow, on && styles.chipOn]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
    >
      {/* numberOfLines=1 + maxFontSizeMultiplier：不换行、也不许字被放大到撑破格子。
          只加前者会变成「维持体…」这种省略号截断，比换行更难看 —— 两个必须一起加。 */}
      <Text
        style={[styles.chipText, on && styles.chipTextOn]}
        numberOfLines={1}
        maxFontSizeMultiplier={FONT_CAP}
      >{label}</Text>
    </Pressable>
  );
}

// 左边那一列标签的统一宽度。「运动」「目标」现在都是 2 个汉字，宽度按 2 字来定 ——
// 汉字是满格宽，大字号手机上 2 个字约 24px，留点余量写 32，两行标签同宽，
// 右边三个选项的左边缘就能落在同一条竖线上（上下对齐）。改一处两边一起动。
// 2026-09-30 由 34 收到 32：省下的横向空间让给右边三个「四个汉字」的选项。
const LABEL_W = 32;

// 第 3、4 行（运动 / 目标）上所有文字的字号放大上限。
// ⚠️ 这两行是「2 字标签 + 三个格子」，横向被排得很满，而且目标行的三个选项
//    全是 4 个汉字（维持体重 / 想要减重 / 控糖优先）。
//    实测：用户手机系统字体放大约 1.2~1.3 倍，13 号字渲染成 15.6~16.9px，
//    「维持体重」要 62~68px，而每格只有 57px —— 于是被截成「维持体…」。
//    把上限钉在 1.2，字宽固定 ≤ 62.4px，配上已收窄的内边距 / 间隔（余量 ~4.5px），
//    用户把系统字体调到多大都不会再截断，也不会换行。
//    想放开这个限制：改这个数，同时必须把 chip 的内边距继续收小或给格子留更多宽。
const FONT_CAP = 1.2;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  // 整体收紧：卡片之间的缝收到最小；底部留足空白，避开底栏 + 至少两行空，
  // 免得最后一行印在底部那几个键下面看不见。
  content: {
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: 72,
    gap: space.xs,
  },
  // 结论卡片：整页最重要的一组数字，用主色压住。
  resultCard: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.lg,
    padding: space.sm,
    gap: space.xs,
  },
  resultLabel: {
    fontSize: 12,
    color: colors.sub,
  },
  // 「每天建议」和大数字同一行：标签左、数字区填满右边，垂直居中。
  resultHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  resultRow: {
    flexDirection: 'row',
  },
  resultCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  resultNum: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.accent,
  },
  resultUnit: {
    fontSize: 13,
    color: colors.sub,
  },
  // 三餐分配：一张表。左列 早/中/晚；每个营养素一列"数值"紧跟一列"占比"，
  // 抬头只写「占比」两字（数值列已标热量/碳水，不重复）。
  mealBlock: {
    // 和建议那两张大数字拉开距离（上密下疏），所以上下都加一点留白；
    // 不写「三餐分配」抬头了 —— 表格本身列名（餐次/热量/碳水）已经说明白。
    marginTop: space.sm,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(31,162,255,0.25)',
  },
  table: {
    width: '100%',
  },
  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 30,
  },
  trHead: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(31,162,255,0.25)',
    marginBottom: 4,
  },
  tc: {
    fontSize: 14,
    paddingHorizontal: 4,
  },
  // 餐次列宽 52：汉字「早餐」在大字号手机上要占 ~40px，写 48 会把第二个字挤成「早…」。
  // 宽度必须留够 —— 汉字是满格宽（一个字就占一个字号那么宽），比数字宽得多，别照数字的宽度估。
  tcName: {
    width: 52,
    textAlign: 'center',
  },
  tcNum: {
    flex: 1,
    textAlign: 'center',
  },
  // 碳水这一组的数值列左边留点缝，让「热量组」和「碳水组」视觉上分开。
  tcNum2: {
    marginLeft: space.sm,
  },
  // 占比列宽 48：只装「30%」这类 3 个字符（数字是半角，很窄），48 足够；
  // 从这里省下的宽度让给餐次列，保证「早餐」不被截断。
  tcPct: {
    width: 48,
    textAlign: 'center',
  },
  th: {
    fontSize: 11,
    color: colors.sub,
  },
  // 抬头里的单位（千卡/克）用更小的字，紧跟营养素名，保证整串横着排在一行不换行。
  thUnit: {
    fontSize: 10,
  },
  td: {
    color: colors.accent,
    fontWeight: '600',
  },
  tdName: {
    color: colors.text,
    fontWeight: '600',
  },
  mealTip: {
    fontSize: 11,
    color: colors.sub,
    marginTop: 6,
    lineHeight: 16,
  },
  // 基本情况卡片：整页唯一可改区，白底浮着，里面的输入框 / 选项再铺浅蓝底，
  // 对比清楚（白卡里一块块浅蓝 = 都能改）。
  // 内边距 8、行距 6，整体偏紧（用户 2026-09-30：概况可再稍紧密）。
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.sm,
    gap: 6,
  },
  // 两列一行：性别+年龄、身高+体重 各占半边。两半之间留 16（space.md），免得左半的「厘米」贴着右半的「体重」。
  twoCol: {
    flexDirection: 'row',
    gap: space.md,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // 标签不写死宽度：让「年龄」两个字按原字号自然排开（写死宽度在大字号手机上会被压成两行）。
  fieldLabel: {
    fontSize: 12,
    color: colors.sub,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  // 左边标签固定一个宽度，几行的选项就能对齐成一列 —— 不靠调空格凑。
  // 宽度见 LABEL_W（34）：「运动」「目标」都是 2 个汉字，约 24px，留余量写 34，
  // 两行标签同宽，右边三个选项的左边缘落在同一条竖线上。
  label: {
    width: LABEL_W,
    fontSize: 12,
    color: colors.sub,
  },
  chips: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  // 第 3、4 行共用：运动 / 目标各三个选项，必须横着排在一行、不许折行；
  // 每个 Chip 用 flex:1 各占 1/3（见 chipGrow），两行左、右边缘对齐（上下对齐）。
  // 间隔 2026-09-30 由 6 收到 4（每格多出约 1.3px）—— 目标是让 4 个汉字塞得进 1/3 格。
  chipRow: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 4,
  },
  // 可选项：浅蓝底（accentSoft）+ 小圆角 = 能点。和照片分析页"能改的那块"同色同形，
  // 全 App 一个规矩：有浅色条就能改。选中时变实色蓝底（chipOn）。
  // ⚠️ 左右内边距 2026-09-30 由 8 一路收到 2：目标行三个四字选项每格只有 1/3 宽（约 73px），
  //    内边距是「纯浪费」的横向空间 —— 文字是 flex 居中的，收到 2 外观完全不变，
  //    但每格能给文字多让出 12px，这才装得下「维持体重」4 个汉字（实测需要 62.4px）。
  //    收到 4 时只剩 0.6px 余量，换台手机换个字体就可能崩，所以留到 2。
  //    上下仍留 5，保证点击区域够高（手指能点中）。
  chip: {
    paddingHorizontal: 2,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.accentSoft,
  },
  // 第 3、4 行三选项共用：flex:1 各占 1/3，文字居中，这样两行的三列左右边界对齐。
  chipGrow: {
    flex: 1,
    alignItems: 'center',
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
    fontWeight: '500',
  },
  // 输入框：整块铺浅蓝底 + 小圆角 = 能改（和照片页同一套语言）。
  // 之前只有一根下划线，现在改成"浅色条"，更明确地告诉用户"这是能填的"。
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    paddingVertical: 2,
    // 数字在框里居中（用户要的：年龄/身高/体重 的数居中）。
    textAlign: 'center',
  },
  unit: {
    fontSize: 11,
    color: colors.sub,
  },
  // 概况：左边竖排标题「个人概况」+ 竖线，右侧四行等间距（不再有中间横线和大留白）。
  profileRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  // 左侧竖条：竖排「个人概况」当标题。用极淡的中性灰底（不是浅蓝——浅蓝是"可改"的标记），
  // 免得和右侧可改区的浅蓝底混淆。
  sideLabel: {
    width: 39, // 2026-09-30：横向扩大 50%（26 → 39），竖条更宽一点
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.045)',
    borderRadius: radius.sm,
  },
  sideChar: {
    fontSize: 13,
    color: colors.sub,
    lineHeight: 17,
  },
  // 竖线：和之前那道中间横线同色，把竖标题和右侧内容分开。
  sideDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.line,
    marginHorizontal: 6,
  },
  // 右侧四行等间距（gap = space.sm），比原来"中间一道大留白"均匀。
  profileContent: {
    flex: 1,
    gap: space.sm,
  },
  // 安全下限卡片：浅底细框，把"地板"单独拎出来，一眼能看到。
  floorCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.sm,
    gap: 2,
  },
  floorTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  floorLine: {
    fontSize: 12,
    color: colors.sub,
    lineHeight: 17,
  },
  floorKey: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  disclaimer: {
    fontSize: 10,
    color: colors.sub,
    lineHeight: 14,
  },
});
