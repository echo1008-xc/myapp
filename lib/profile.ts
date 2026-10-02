import AsyncStorage from '@react-native-async-storage/async-storage';

// ============================================================
// 「我的目标」—— 每天该吃多少热量、多少碳水（2026-09-26 新建）
// ============================================================
// 用户原话：「在今日总热量那个上面增加一条『我的目标』，后面就是总热量、总碳水各多少。
// 点开来里面是输入详情，有年龄、身高、体重等等。输入之后输出一个健康建议。」
//
// 数字怎么来的（**不是拍的，是有出处的**）：
//   ① 基础代谢 BMR 用 **Mifflin-St Jeor 公式**。世界卫生组织建议用它替代老的
//      Harris-Benedict（老公式对偏胖的人误差大）。多项临床研究里它预测误差 < 5%。
//          男：BMR = 10×体重(kg) + 6.25×身高(cm) − 5×年龄 + 5
//          女：BMR = 10×体重(kg) + 6.25×身高(cm) − 5×年龄 − 161
//   ② 再乘**活动系数**得到每天总消耗 TDEE：
//          轻度 1.375 / 中度 1.55 / 高度 1.725（最低档即轻度，已无「久坐」）
//   ③ 碳水占多少：按《中国居民膳食指南(2022)》，碳水供能应占 50%~65%；
//      减重人群可以降到 40%~50%（光明网/中国食品安全网引专家口径一致）。
//      所以这里：维持 50%、减重 45%、控糖 45% —— 一律取区间下缘，宁少不多。
//   ④ 每克碳水 = 4 千卡。
//
// ⚠️ 三条刻意守住的底线：
//   ① **减重缺口固定 400 千卡**（指南说 300~500，取中间），并且**热量绝不低于下限**：
//      女性 ≥1200、男性 ≥1500 千卡/天（多份卫健委/营养科口径）—— 再低会压低代谢、丢肌肉、易反弹。
//      碳水**绝不低于 RDA 130 克/天** —— 再低大脑缺糖、逼出酮症，控糖反而更不稳。这两条是「地板」。
//   ② 一切输入都做**范围裁剪**（clamp）：手滑多按一个 0 也只会算出一个怪数字，
//      不会崩、不会算出负数。
//   ③ 这只是一个**估算**。个体差异 10% 以上很常见，而且糖尿病、肾病、孕期
//      这些情况必须听医生的 —— 所以界面上必须带这句提醒，不能只丢两个数字。

export type Sex = 'male' | 'female';
export type ActivityKey = 'light' | 'medium' | 'high';
export type GoalKey = 'keep' | 'lose' | 'sugar';

export type Profile = {
  sex: Sex;
  age: number; // 岁
  heightCm: number; // 厘米
  weightKg: number; // 公斤
  activity: ActivityKey;
  goal: GoalKey;
};

export const SEXES: { key: Sex; label: string }[] = [
  { key: 'male', label: '男' },
  { key: 'female', label: '女' },
];

// 活动系数。最低档即「轻度」（已移除「久坐」选项，让用户自行判断运动量级）。
export const ACTIVITIES: { key: ActivityKey; label: string; factor: number }[] = [
  { key: 'light', label: '轻度', factor: 1.375 },
  { key: 'medium', label: '中度', factor: 1.55 },
  { key: 'high', label: '高度', factor: 1.725 },
];

// 目标。delta 是热量加减（千卡），carbRatio 是碳水占总热量的比例。
export const GOALS: { key: GoalKey; label: string; delta: number; carbRatio: number }[] = [
  { key: 'keep', label: '维持体重', delta: 0, carbRatio: 0.5 },
  { key: 'lose', label: '想要减重', delta: -400, carbRatio: 0.45 },
  { key: 'sugar', label: '控糖优先', delta: 0, carbRatio: 0.45 },
];

// 三餐能量分配（占全天比例，早/午/晚）。用的是《中国居民膳食指南2022》的「黄金比例」3:4:3：
// 早餐 25%~30%、午餐 30%~40%、晚餐 30%~35%，取 30/40/30 这一档（落在所有区间里）。
export const MEAL_CAL_SPLIT: readonly [number, number, number] = [0.3, 0.4, 0.3];

// 碳水按目标给不同分法。控糖优先时把**早餐碳水压低**（晨间胰岛素敏感性差、黎明现象，
// 早上血糖最难控），多出来的挪到午晚餐；维持/减重则跟着能量走 30/40/30。
// 这是「热量和碳水三餐比例不同」的关键：只有控糖模式才特意错开。
export function mealCarbSplit(goal: GoalKey): readonly [number, number, number] {
  if (goal === 'sugar') return [0.25, 0.4, 0.35]; // 早25% 午40% 晚35%
  return MEAL_CAL_SPLIT; // 30/40/30
}

// 热量硬下限：长期低于会压低代谢、丢肌肉、易反弹 —— 任何目标都不许突破。
// 男女不同（多份卫健委/营养科口径）：女性 ≥1200、男性 ≥1500 千卡/天。
export function minCalories(sex: Sex): number {
  return sex === 'female' ? 1200 : 1500;
}

// 碳水硬下限：RDA 130 克/天（大脑每天约消耗 120g 葡萄糖，低于就逼身体走酮症、
// 营养失衡，控糖反而更不稳）。这是「地板」，不是目标。
export const MIN_CARB = 130;

// 各项输入的合理范围。超出去的一律**裁剪**到边界，而不是报错或丢弃。
export const LIMITS = {
  age: { min: 18, max: 100 }, // 公式本身是成人公式，儿童要用另一套，不适用
  heightCm: { min: 120, max: 220 },
  weightKg: { min: 30, max: 250 },
};

// 没填过的时候给一套中性的默认值。为什么要有：用户点进来就能直接看到一组数字，
// 改哪个看哪个变化 —— 比对着六个空框发呆强。
export const DEFAULT_PROFILE: Profile = {
  sex: 'male',
  age: 35,
  heightCm: 170,
  weightKg: 68,
  activity: 'light',
  goal: 'keep',
};

const STORAGE_KEY = 'myapp.profile.v1';

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function numOr(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return typeof n === 'number' && isFinite(n) ? n : fallback;
}

// 把任意来源（存储、输入框）的东西整成一份合法档案。
// 认不出来的一律退回默认值 —— 绝不把 NaN 放进公式（那会算出「NaN 千卡」）。
export function sanitizeProfile(raw: unknown): Profile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Profile>;
  const sex: Sex = r.sex === 'female' ? 'female' : 'male';
  const activity = ACTIVITIES.some((a) => a.key === r.activity)
    ? (r.activity as ActivityKey)
    : DEFAULT_PROFILE.activity;
  const goal = GOALS.some((g) => g.key === r.goal) ? (r.goal as GoalKey) : DEFAULT_PROFILE.goal;
  return {
    sex,
    activity,
    goal,
    age: clamp(Math.round(numOr(r.age, DEFAULT_PROFILE.age)), LIMITS.age.min, LIMITS.age.max),
    heightCm: clamp(
      Math.round(numOr(r.heightCm, DEFAULT_PROFILE.heightCm)),
      LIMITS.heightCm.min,
      LIMITS.heightCm.max,
    ),
    weightKg: clamp(
      Math.round(numOr(r.weightKg, DEFAULT_PROFILE.weightKg)),
      LIMITS.weightKg.min,
      LIMITS.weightKg.max,
    ),
  };
}

// 基础代谢（千卡/天）。Mifflin-St Jeor 公式。
export function bmr(p: Profile): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  return p.sex === 'male' ? base + 5 : base - 161;
}

// 三餐拆分（按占全天比例算出来的建议值，单位与总量一致）。
export type MealBreakdown = {
  breakfast: { calories: number; carb: number };
  lunch: { calories: number; carb: number };
  dinner: { calories: number; carb: number };
};

export type Target = {
  bmr: number; // 基础代谢，千卡
  tdee: number; // 每天总消耗，千卡
  calories: number; // 建议每天吃多少千卡（已取整到 10）
  carb: number; // 建议每天吃多少克碳水（已取整到 5）
  meal: MealBreakdown; // 三餐各自的热量/碳水建议
};

const roundTo = (n: number, step: number): number => Math.round(n / step) * step;

// 算出建议值。纯函数 —— 给它一份档案，它给一组数字，不碰存储、不碰界面。
export function dailyTarget(input: Profile): Target {
  const p = sanitizeProfile(input);
  const base = bmr(p);
  const act = ACTIVITIES.find((a) => a.key === p.activity) ?? ACTIVITIES[0];
  const goal = GOALS.find((g) => g.key === p.goal) ?? GOALS[0];

  const tdee = base * act.factor;
  const calories = roundTo(Math.max(tdee + goal.delta, minCalories(p.sex)), 10);
  // 碳水先按总热量×比例算，再兜住 130 克下限（低于伤身）。
  const carb = Math.max(roundTo((calories * goal.carbRatio) / 4, 5), MIN_CARB);

  // 三餐拆分：能量统一 30/40/30；碳水按目标走（控糖时早餐压低）。
  const calSplit = MEAL_CAL_SPLIT;
  const carbSplit = mealCarbSplit(goal.key);
  const meal: MealBreakdown = {
    breakfast: {
      calories: roundTo(calories * calSplit[0], 10),
      carb: roundTo(carb * carbSplit[0], 5),
    },
    lunch: {
      calories: roundTo(calories * calSplit[1], 10),
      carb: roundTo(carb * carbSplit[1], 5),
    },
    dinner: {
      calories: roundTo(calories * calSplit[2], 10),
      carb: roundTo(carb * carbSplit[2], 5),
    },
  };

  return {
    bmr: Math.round(base),
    tdee: Math.round(tdee),
    calories,
    carb,
    meal,
  };
}

// 读档案。没设置过返回 null（界面据此显示「还没设置」）——
// 注意**不是**返回默认值：默认值是用来填输入框的，不能让人以为"我设过了"。
export async function readProfile(): Promise<Profile | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return sanitizeProfile(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

// 存档案。改一个输入框就调一次（界面是"改了立刻生效"，没有保存按钮）——
// 写不进去也只是下次打开回到旧值，不该弹错误。
export async function saveProfile(p: Profile): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeProfile(p)));
  } catch {
    // 静默失败：目标数字还在屏幕上，不该因为写存储失败就报错。
  }
}
