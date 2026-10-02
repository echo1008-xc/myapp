// 餐盘分析用到的数据结构。
// 手机上（App）和云端函数（Edge Function）都按这个形状对接：
// 谁改了字段名，另一边必须跟着改，否则读出来是空的。
//
// ⚠️ v4（2026-09-23）：不再统计「油脂」，并把「糖」换成「碳水化合物」。
//   carb 的口径 = 食品标签上「碳水化合物」那一栏（含淀粉、糖、膳食纤维），
//   跟 lib/meal/foodDb.ts 里那张食物表完全一致，改一处必须改两处。

// 一种被识别出来的食物。
export type MealItem = {
  name: string; // 食物名称，如「宫保鸡丁」
  // 估算重量，单位：克（g）。必须是数字，界面上「可修改的份量」用的就是它。
  // 认不出重量时是 0，界面会自动退化成只显示 portion 文字、不允许修改。
  grams: number;
  portion: string; // 份量的日常说法，如「约 150 克」「一小碗」
  calories: number; // 热量，单位：千卡（kcal）
  carb: number; // 碳水化合物，单位：克（g）
  note?: string; // 补充说明，如「油炸」「带酱汁，碳水偏高」
};

// 整餐的合计。
export type MealTotals = {
  calories: number;
  carb: number;
};

// 一次分析的完整结果。
export type MealAnalysis = {
  items: MealItem[];
  totals: MealTotals;
  summary: string; // 一句话总评
  // 可信度。照片看不清、份量难判时，模型会主动标低，
  // 我们在界面上也要如实提示「这是估算，不是称量」。
  confidence: 'low' | 'medium' | 'high';
  // ★ 2026-09-26（云端 v8）：这一次分析**实际用到了哪些参照物**，
  //   例如「筷子24cm + 鸡蛋」。它是「份量是怎么估出来的」最直接的证据 ——
  //   用户看一眼就知道这个数是「有尺子量过的」还是「凭常见份量猜的」。
  //   一把都没找到时云端写「无参照物」，那种情况在 api.ts 里会被丢掉、
  //   不显示（逐项的 note 里已经说明了，不必再重复一句丧气话）。
  scale?: string;
  // 云端函数还是旧版（只返回 sugar/fat，没有 carb）时为 true。
  // 这时界面要明确提示「数字不准，请重新部署云端函数」，而不是默默显示 0。
  legacyFormat?: boolean;
  // legacyFormat 为 true 时，有几项成功用本地食物表补出了碳水。
  // 界面用这个数决定措辞：补上了就说「已按本地表估算」，
  // 一项都没补上就说「本地表也没匹配到，碳水暂显示 0」。
  legacyFilled?: number;
};
