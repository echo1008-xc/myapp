// 本地常见食物营养库（数值按「每 100 克」给）。
//
// 用途：用户自己添加食物时，先用这张表算 —— 不联网、瞬间出结果。
// 表里没有的（比如「佛跳墙」），才去问云端 AI（见 api.ts 的 estimateFood）。
//
// ⚠️ 口径（和云端函数提示词必须一致，改一处要改两处）：
//   calories 热量，单位千卡(kcal)
//   carb     碳水化合物，单位克(g) —— 就是食品包装上营养成分表里
//            「碳水化合物」那一栏：淀粉 + 糖 + 膳食纤维都算进去。
//
//            ⚠️ 这一点最容易搞错：以前的版本算的是「糖」（主食淀粉不算），
//            所以米饭只有 0.3 克；换成碳水后米饭是 26 克 —— 现在这个数字
//            才和你在医院/体检报告里看到的口径一致。
//            规律：主食、甜点、饮料、水果偏高；肉、蛋、鱼、油几乎为 0。
//
// 数据取自常见食物成分表并按中式家常做法做了调整（比如「炒青菜」含油，
// 不是生青菜的数值）。目标是「量级对」，不是实验室精度。

export type FoodNutrient = {
  calories: number;
  carb: number;
};

export type FoodEntry = {
  // 关键词。用户输入里只要「包含」其中一个就算命中（按匹配到的关键词长度优先）。
  match: string[];
  // 规范名称，命中后显示给用户看（让他知道是按什么算的）。
  label: string;
  per100: FoodNutrient;
  // 这类食物通常一份多少克，用作输入框的提示值。
  typical: number;
};

export const FOOD_DB: FoodEntry[] = [
  // ---------- 主食 ----------
  { match: ['米饭', '白饭', '白米饭', '大米饭'], label: '米饭', per100: { calories: 116, carb: 26 }, typical: 200 },
  { match: ['蛋炒饭', '炒饭'], label: '蛋炒饭', per100: { calories: 163, carb: 24 }, typical: 250 },
  { match: ['炒面'], label: '炒面', per100: { calories: 200, carb: 24 }, typical: 250 },
  { match: ['面条', '挂面', '汤面', '拉面', '煮面'], label: '面条（煮）', per100: { calories: 110, carb: 24 }, typical: 250 },
  { match: ['米线', '米粉', '河粉'], label: '米线/米粉', per100: { calories: 105, carb: 24 }, typical: 250 },
  { match: ['馒头'], label: '馒头', per100: { calories: 223, carb: 47 }, typical: 100 },
  { match: ['花卷'], label: '花卷', per100: { calories: 214, carb: 45 }, typical: 100 },
  { match: ['包子'], label: '包子（肉馅）', per100: { calories: 227, carb: 33 }, typical: 100 },
  { match: ['饺子', '水饺', '锅贴'], label: '饺子', per100: { calories: 240, carb: 26 }, typical: 200 },
  { match: ['馄饨', '云吞'], label: '馄饨', per100: { calories: 150, carb: 18 }, typical: 250 },
  { match: ['小笼包'], label: '小笼包', per100: { calories: 240, carb: 30 }, typical: 100 },
  { match: ['面包', '吐司'], label: '面包', per100: { calories: 312, carb: 50 }, typical: 80 },
  { match: ['油条'], label: '油条', per100: { calories: 386, carb: 51 }, typical: 60 },
  { match: ['粥', '稀饭'], label: '白粥', per100: { calories: 46, carb: 10 }, typical: 300 },
  { match: ['燕麦'], label: '燕麦片', per100: { calories: 367, carb: 66 }, typical: 50 },
  { match: ['红薯', '地瓜', '番薯'], label: '红薯', per100: { calories: 86, carb: 20 }, typical: 150 },
  { match: ['玉米'], label: '玉米', per100: { calories: 86, carb: 22 }, typical: 150 },
  // 「炸薯条」单独列，否则「薯条」会命中下面的土豆（土豆是水煮口径）。
  { match: ['薯条'], label: '炸薯条', per100: { calories: 298, carb: 41 }, typical: 100 },
  { match: ['土豆', '马铃薯', '土豆丝', '炒土豆'], label: '土豆', per100: { calories: 81, carb: 17 }, typical: 150 },
  { match: ['山药'], label: '山药', per100: { calories: 57, carb: 12 }, typical: 150 },
  { match: ['南瓜'], label: '南瓜', per100: { calories: 26, carb: 5 }, typical: 150 },
  { match: ['莲藕', '藕'], label: '莲藕', per100: { calories: 74, carb: 16 }, typical: 100 },

  // ---------- 肉蛋（碳水都极低，肉本身几乎不含碳水）----------
  { match: ['红烧肉'], label: '红烧肉', per100: { calories: 480, carb: 7 }, typical: 80 },
  { match: ['五花肉'], label: '五花肉', per100: { calories: 508, carb: 1 }, typical: 60 },
  { match: ['排骨'], label: '排骨', per100: { calories: 278, carb: 1 }, typical: 120 },
  { match: ['里脊', '瘦肉'], label: '猪瘦肉', per100: { calories: 143, carb: 1 }, typical: 100 },
  { match: ['猪肉', '肉丝', '肉片'], label: '猪肉', per100: { calories: 395, carb: 1 }, typical: 100 },
  { match: ['鸡胸'], label: '鸡胸肉', per100: { calories: 133, carb: 1 }, typical: 120 },
  { match: ['鸡腿'], label: '鸡腿', per100: { calories: 181, carb: 1 }, typical: 100 },
  { match: ['炸鸡'], label: '炸鸡', per100: { calories: 250, carb: 12 }, typical: 100 },
  { match: ['鸡肉', '鸡翅', '鸡'], label: '鸡肉', per100: { calories: 167, carb: 1 }, typical: 100 },
  { match: ['牛肉', '牛排'], label: '牛肉', per100: { calories: 135, carb: 1 }, typical: 120 },
  { match: ['羊肉'], label: '羊肉', per100: { calories: 203, carb: 1 }, typical: 100 },
  { match: ['三文鱼', '鲑鱼'], label: '三文鱼', per100: { calories: 139, carb: 0 }, typical: 120 },
  { match: ['带鱼'], label: '带鱼', per100: { calories: 127, carb: 1 }, typical: 120 },
  { match: ['鱼'], label: '鱼肉', per100: { calories: 104, carb: 1 }, typical: 150 },
  { match: ['虾'], label: '虾', per100: { calories: 93, carb: 1 }, typical: 100 },
  { match: ['蟹'], label: '螃蟹', per100: { calories: 103, carb: 2 }, typical: 100 },
  { match: ['煎蛋', '荷包蛋'], label: '煎蛋', per100: { calories: 200, carb: 1 }, typical: 55 },
  { match: ['鸡蛋', '水煮蛋', '蛋'], label: '鸡蛋', per100: { calories: 144, carb: 2 }, typical: 50 },
  { match: ['香肠', '腊肠'], label: '香肠', per100: { calories: 508, carb: 12 }, typical: 50 },
  { match: ['培根'], label: '培根', per100: { calories: 181, carb: 2 }, typical: 30 },
  { match: ['火腿'], label: '火腿', per100: { calories: 100, carb: 5 }, typical: 50 },

  // ---------- 豆制品 ----------
  { match: ['豆腐'], label: '豆腐', per100: { calories: 82, carb: 4 }, typical: 150 },
  { match: ['豆干', '香干'], label: '豆干', per100: { calories: 140, carb: 12 }, typical: 80 },
  { match: ['腐竹'], label: '腐竹', per100: { calories: 459, carb: 22 }, typical: 50 },
  { match: ['豆浆'], label: '豆浆', per100: { calories: 30, carb: 3 }, typical: 300 },

  // ---------- 蔬菜（按家常做法含油量调整）----------
  { match: ['番茄炒蛋', '西红柿炒蛋'], label: '番茄炒蛋', per100: { calories: 100, carb: 6 }, typical: 200 },
  { match: ['红烧茄子'], label: '红烧茄子', per100: { calories: 150, carb: 8 }, typical: 150 },
  { match: ['干煸豆角', '干煸四季豆'], label: '干煸豆角', per100: { calories: 140, carb: 8 }, typical: 150 },
  { match: ['青菜', '小白菜', '油菜', '菠菜', '蔬菜', '生菜'], label: '炒青菜', per100: { calories: 60, carb: 3 }, typical: 150 },
  { match: ['西兰花'], label: '西兰花', per100: { calories: 45, carb: 6 }, typical: 150 },
  { match: ['白菜'], label: '白菜', per100: { calories: 40, carb: 3 }, typical: 150 },
  { match: ['黄瓜'], label: '黄瓜', per100: { calories: 30, carb: 3 }, typical: 100 },
  { match: ['番茄', '西红柿'], label: '番茄', per100: { calories: 20, carb: 4 }, typical: 150 },
  { match: ['茄子'], label: '茄子', per100: { calories: 90, carb: 5 }, typical: 150 },
  { match: ['青椒', '辣椒', '尖椒'], label: '青椒', per100: { calories: 40, carb: 6 }, typical: 100 },
  { match: ['萝卜'], label: '萝卜', per100: { calories: 35, carb: 5 }, typical: 150 },
  { match: ['胡萝卜'], label: '胡萝卜', per100: { calories: 45, carb: 10 }, typical: 100 },
  { match: ['香菇', '蘑菇', '木耳', '菌'], label: '菌菇类', per100: { calories: 45, carb: 5 }, typical: 100 },
  { match: ['海带', '紫菜'], label: '海带/紫菜', per100: { calories: 20, carb: 3 }, typical: 80 },
  { match: ['洋葱'], label: '洋葱', per100: { calories: 55, carb: 9 }, typical: 80 },
  { match: ['豆芽'], label: '豆芽', per100: { calories: 45, carb: 4 }, typical: 100 },
  { match: ['韭菜'], label: '韭菜', per100: { calories: 45, carb: 4 }, typical: 100 },
  { match: ['冬瓜'], label: '冬瓜', per100: { calories: 30, carb: 3 }, typical: 200 },
  { match: ['丝瓜'], label: '丝瓜', per100: { calories: 40, carb: 4 }, typical: 150 },
  { match: ['苦瓜'], label: '苦瓜', per100: { calories: 40, carb: 4 }, typical: 150 },

  // ---------- 汤 ----------
  { match: ['紫菜蛋花汤', '蛋花汤'], label: '紫菜蛋花汤', per100: { calories: 25, carb: 2 }, typical: 300 },
  { match: ['排骨汤', '骨汤'], label: '排骨汤', per100: { calories: 60, carb: 1 }, typical: 300 },
  { match: ['鸡汤'], label: '鸡汤', per100: { calories: 45, carb: 1 }, typical: 300 },
  { match: ['汤'], label: '汤', per100: { calories: 35, carb: 3 }, typical: 300 },

  // ---------- 水果 ----------
  { match: ['苹果'], label: '苹果', per100: { calories: 54, carb: 13 }, typical: 180 },
  { match: ['香蕉'], label: '香蕉', per100: { calories: 93, carb: 22 }, typical: 120 },
  { match: ['橙', '橘', '柑', '柚子'], label: '橙/橘', per100: { calories: 48, carb: 12 }, typical: 150 },
  { match: ['西瓜'], label: '西瓜', per100: { calories: 31, carb: 8 }, typical: 300 },
  { match: ['葡萄', '提子'], label: '葡萄', per100: { calories: 45, carb: 10 }, typical: 150 },
  { match: ['草莓'], label: '草莓', per100: { calories: 32, carb: 7 }, typical: 150 },
  { match: ['梨'], label: '梨', per100: { calories: 51, carb: 13 }, typical: 180 },
  { match: ['桃'], label: '桃', per100: { calories: 51, carb: 12 }, typical: 150 },
  { match: ['芒果'], label: '芒果', per100: { calories: 35, carb: 9 }, typical: 150 },
  { match: ['蓝莓', '莓'], label: '蓝莓', per100: { calories: 57, carb: 14 }, typical: 100 },
  { match: ['猕猴桃', '奇异果'], label: '猕猴桃', per100: { calories: 61, carb: 14 }, typical: 100 },

  // ---------- 饮料 ----------
  { match: ['可乐'], label: '可乐', per100: { calories: 43, carb: 11 }, typical: 330 },
  { match: ['雪碧', '汽水', '碳酸'], label: '碳酸饮料', per100: { calories: 43, carb: 11 }, typical: 330 },
  { match: ['橙汁', '果汁'], label: '果汁', per100: { calories: 45, carb: 10 }, typical: 250 },
  { match: ['奶茶'], label: '奶茶', per100: { calories: 70, carb: 12 }, typical: 500 },
  { match: ['拿铁', '卡布'], label: '拿铁咖啡', per100: { calories: 55, carb: 6 }, typical: 350 },
  { match: ['美式', '黑咖啡', '咖啡'], label: '咖啡（无糖）', per100: { calories: 2, carb: 0 }, typical: 250 },
  { match: ['啤酒'], label: '啤酒', per100: { calories: 43, carb: 4 }, typical: 330 },
  { match: ['白酒'], label: '白酒', per100: { calories: 298, carb: 0 }, typical: 50 },
  { match: ['牛奶'], label: '牛奶', per100: { calories: 64, carb: 5 }, typical: 250 },
  { match: ['酸奶'], label: '酸奶', per100: { calories: 72, carb: 12 }, typical: 150 },
  { match: ['豆奶', '豆乳'], label: '豆奶', per100: { calories: 30, carb: 3 }, typical: 250 },
  { match: ['茶'], label: '茶（无糖）', per100: { calories: 1, carb: 0 }, typical: 300 },

  // ---------- 甜点零食 ----------
  { match: ['蛋糕'], label: '蛋糕', per100: { calories: 350, carb: 50 }, typical: 100 },
  { match: ['饼干'], label: '饼干', per100: { calories: 433, carb: 65 }, typical: 50 },
  { match: ['巧克力'], label: '巧克力', per100: { calories: 586, carb: 55 }, typical: 30 },
  { match: ['冰淇淋', '雪糕', '冰激凌'], label: '冰淇淋', per100: { calories: 127, carb: 25 }, typical: 100 },
  { match: ['薯片'], label: '薯片', per100: { calories: 536, carb: 52 }, typical: 50 },
  { match: ['坚果', '花生', '核桃', '腰果'], label: '坚果', per100: { calories: 574, carb: 20 }, typical: 30 },
  { match: ['瓜子'], label: '瓜子', per100: { calories: 606, carb: 20 }, typical: 30 },

  // ---------- 酱料 / 做法 ----------
  { match: ['酱油'], label: '酱油', per100: { calories: 63, carb: 10 }, typical: 10 },
  { match: ['沙拉酱', '蛋黄酱'], label: '沙拉酱', per100: { calories: 700, carb: 6 }, typical: 20 },
  { match: ['番茄酱'], label: '番茄酱', per100: { calories: 85, carb: 22 }, typical: 20 },
  { match: ['辣椒酱', '老干妈', '豆瓣酱'], label: '辣椒酱', per100: { calories: 500, carb: 10 }, typical: 15 },
  { match: ['糖醋'], label: '糖醋菜', per100: { calories: 180, carb: 20 }, typical: 150 },
  { match: ['鱼香'], label: '鱼香菜', per100: { calories: 150, carb: 15 }, typical: 150 },
  { match: ['麻辣香锅'], label: '麻辣香锅', per100: { calories: 250, carb: 15 }, typical: 300 },
  { match: ['火锅'], label: '火锅', per100: { calories: 200, carb: 10 }, typical: 300 },
  { match: ['烤串', '烧烤', '羊肉串'], label: '烧烤', per100: { calories: 250, carb: 5 }, typical: 150 },
  { match: ['凉拌', '拍黄瓜'], label: '凉拌菜', per100: { calories: 80, carb: 6 }, typical: 150 },
];

// 表里查不到、云端又调不通时的兜底：按「不油不甜的家常菜」中位值估。
// 宁可能量明显标错也不让用户卡住 —— 他可以自己改克数，或者（下一步）
// 直接在界面上看到「这是按平均值估的」。
export const FALLBACK_PER100: FoodNutrient = { calories: 150, carb: 12 };

// 在本地表里找一个最匹配的条目。
// 规则：按「命中的关键词长度」优先，越长越具体。
// 例：输入「蛋炒饭」，既能命中「蛋炒饭」(3)、也能命中更短的词，取更长的「蛋炒饭」。
export function lookupFood(name: string): FoodEntry | null {
  const q = (name ?? '').trim();
  if (!q) return null;
  let best: FoodEntry | null = null;
  let bestLen = 0;
  for (const e of FOOD_DB) {
    for (const k of e.match) {
      if (k.length > bestLen && q.includes(k)) {
        best = e;
        bestLen = k.length;
      }
    }
  }
  return best;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// 按克数把「每 100 克」换算成「这一份」。
export function scaleNutrient(per100: FoodNutrient, grams: number): FoodNutrient {
  const r = (Number.isFinite(grams) ? grams : 0) / 100;
  return {
    calories: round1(per100.calories * r),
    carb: round1(per100.carb * r),
  };
}
