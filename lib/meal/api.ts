import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import { FALLBACK_PER100, lookupFood, scaleNutrient } from './foodDb';
import type { FoodNutrient } from './foodDb';
import type { MealAnalysis, MealItem } from './types';

// 把手机里的照片（base64 字符串）发给云端函数，换回分析结果。
//
// 为什么不直接在 App 里调 DeepSeek？
// 因为 API Key 一旦写进 App，别人把安装包反编译就能看到，会被盗刷。
// Key 只存在云端函数的环境变量里，App 只知道云端函数的地址，不知道 Key。

// 云端没配置时，这个功能整体不可用（其余任务功能不受影响）。
export const isMealAnalysisEnabled = Boolean(supabase);

// 把任意东西转成数字：模型偶尔会返回 "174" 这种字符串，或者干脆漏字段。
function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n === 'number' && isFinite(n)) {
    return Math.round(n * 10) / 10; // 保留一位小数，避免出现 173.9999999
  }
  return fallback;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

// 「这次用了哪些参照物」（云端 v8 的 scale 字段）。
// 只在**真的找到了尺子**时才拿它当回事 —— 云端写「无参照物」时返回 undefined，
// 界面就不显示这一行：那种情况逐项的 note 里已经写着「无参照物，按常见份量估」了，
// 卡片上再挂一句丧气话没有意义。
export function tidyScale(v: unknown): string | undefined {
  const s = str(v);
  if (!s || /无参照|没有参照|没有可比|未知|unknown|n\/?a/i.test(s)) {
    return undefined;
  }
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

// ============================================================
// 把估算数字「收口」（2026-09-26）
// ============================================================
// 起因：用户反映「同一张照片每次估值都不一样，估了 3 次是 3 种答案」。
// 根子在模型那边（见云端函数 v6 说明：思考模式下 temperature 不生效），
// 但这里做一层收口，让「即使模型抖了，落到屏幕上也可能还是同一个数」。
//
// 道理：照片估重本来就有误差，模型给「173 克 / 487 千卡」和
// 「175 克 / 485 千卡」，在体验上根本就是同一个答案 ——
// 但**看起来**像每次都不同，用户就会觉得这东西不可信。
// 把这些没有意义的尾数抹掉，屏幕上的数字自然就稳了。
//
// 规则（跟云端提示词里要求的一致，两边同口径）：
//   克数 → 5 的整数倍      热量 → 5 的整数倍      碳水 → 整数
// ⚠️ 只对「AI 估出来的结果」收口。用户自己填的克数一律照原样用 ——
//    那是他亲手打的数，不该被我们改。
export function tidyGrams(g: number): number {
  if (!(g > 0)) {
    return 0;
  }
  const r = Math.round(g / 5) * 5;
  return r > 0 ? r : 5; // 「一筷子菜」别被收成 0
}

export function tidyCalories(c: number): number {
  return c > 0 ? Math.round(c / 5) * 5 : 0;
}

export function tidyCarb(c: number): number {
  return c > 0 ? Math.round(c) : 0;
}

// 取克数。
// 首选模型给的 grams 字段；万一它没给（比如云端函数还没重新部署到新版本），
// 就从「约 150 克」这类文字里抠一个数字出来，界面仍可修改。
// ⚠️ 特意只认带「克 / g」单位的数字：「两块排骨」不能抠出个 2 克。
export function pickGrams(rawGrams: unknown, portion: string): number {
  const direct = num(rawGrams, 0);
  if (direct > 0) return direct;
  const m = portion.match(/(\d+(?:\.\d+)?)\s*(?:g|G|克|ｇ)/);
  if (m) return num(m[1], 0);
  return 0;
}

// 云端函数还是旧版吗？
// 旧版返回的是 sugar / fat（糖 / 油），新版返回 carb（碳水）。两者口径不同：
// 旧版的「糖」把主食淀粉排除在外（米饭只有 0.3 克），直接当碳水用会低得离谱，
// 而且数字看起来还挺合理 —— 这种错误最难发现，所以宁可明说「不准」。
function isLegacyShape(rawItems: unknown[]): boolean {
  if (!rawItems.length) return false;
  let anyCarb = false;
  let anyOld = false;
  for (const it of rawItems) {
    const r = (it ?? {}) as Record<string, unknown>;
    if ('carb' in r) anyCarb = true;
    if ('sugar' in r || 'fat' in r) anyOld = true;
  }
  return !anyCarb && anyOld;
}

function normalizeItem(raw: unknown, legacy: boolean): { item: MealItem; filled: boolean } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const portion = str(r.portion, '份量未知');
  const name = str(r.name, '未知食物');
  const grams = tidyGrams(pickGrams(r.grams, portion));
  let carb = num(r.carb);
  let note = str(r.note) || undefined;
  let filled = false;

  // 云端函数还没更新到 v4（只回「糖 / 油」，没有碳水）时，carb 一律是 0。
  // 一整片 0 比「有偏差的估算」更糟 —— 用户会以为这顿饭真的没碳水。
  // 所以：拿本地食物表按名字补一个量级正确的数，并在备注里写明来源，
  // 用户看到「碳水按『米饭』估」就知道这个数是怎么来的，也能自己改。
  // 表里查不到（或没给克数）就保持 0，界面会另作说明。
  if (legacy && carb <= 0 && grams > 0) {
    const hit = lookupFood(name);
    if (hit) {
      carb = scaleNutrient(hit.per100, grams).carb;
      filled = true;
      const tag = `碳水按「${hit.label}」估`;
      note = note ? `${note}｜${tag}` : tag;
    }
  }

  return {
    item: {
      name,
      grams,
      portion,
      calories: tidyCalories(num(r.calories)),
      carb: tidyCarb(carb),
      note,
    },
    filled,
  };
}

// 云端回传的数据不完全可信（模型偶尔少给字段），这里逐项兜底，
// 保证界面永远拿到结构完整的数据 —— 少一个字段就白屏，是最让人抓狂的体验。
export function normalizeAnalysis(raw: unknown): MealAnalysis {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rawItems = Array.isArray(r.items) ? r.items : [];
  const legacy = isLegacyShape(rawItems);
  const normalized = rawItems.map((it) => normalizeItem(it, legacy));
  const items = normalized.map((n) => n.item);
  // 合计一律**自己把明细加起来**，不采信模型写的 totals。
  // 理由：① 提示词里已经要求它「totals 必须是所有 items 之和」，
  //         自己加既能纠正它偶尔的加法错误，也绝不会显示 0 让人误会「这顿饭没热量」；
  //       ② 明细收口（克数取 5 的倍数）之后，只有自己加才能保证
  //         「各项加得起来正好等于合计」—— 用户一算对不上，就不信这个数字了。
  const totals = {
    calories: items.reduce((s, i) => s + i.calories, 0),
    carb: items.reduce((s, i) => s + i.carb, 0),
  };
  const c = str(r.confidence, 'medium');
  return {
    items,
    totals,
    summary: str(r.summary, '已识别出图中的食物，份量为估算值。'),
    confidence: c === 'low' || c === 'high' ? c : 'medium',
    // 云端 v8：这一次用了哪些参照物（写「无参照物」时这里是 undefined）。
    scale: tidyScale(r.scale),
    legacyFormat: legacy,
    // 旧版云端下，有几项成功用本地表补出了碳水。界面据此决定怎么解释。
    legacyFilled: normalized.filter((n) => n.filled).length,
  };
}

// supabase-js 遇到非 2xx 时只会抛一句英文通用话术
// （「Edge Function returned a non-2xx status code」），
// 云端真正说的那句中文在 `error.context`（原始 Response）里，而且**还没被读掉**。
// 不把它读出来的话：用户看到的是一句没法处理的话，我们事后也无从判断。
// ⚠️ 2026-09-25 那次「照片分析失败」就是靠这一段才第一次看见真话 ——
//    后端其实一直在说「模型没有返回可解析的结果」。
async function backendMessage(err: unknown, fallback: string): Promise<string> {
  const ctx = (err as { context?: unknown } | null | undefined)?.context as
    | Response
    | undefined;
  if (!ctx || typeof ctx.text !== 'function') {
    return fallback;
  }
  try {
    const text = await ctx.text();
    if (!text.trim()) {
      return fallback;
    }
    try {
      const j = JSON.parse(text) as { error?: unknown; detail?: unknown };
      const msg = typeof j.error === 'string' ? j.error.trim() : '';
      if (!msg) {
        return fallback;
      }
      const detail = typeof j.detail === 'string' ? j.detail.trim() : '';
      return detail ? `${msg}（${detail.slice(0, 80)}）` : msg;
    } catch {
      return text.trim().slice(0, 120);
    }
  } catch {
    return fallback;
  }
}

// 云端一次分析要 5~13 秒，而这条链路**不稳**：
// 2026-09-25 实测同一张照片连打 3 次，可能只成 1 次 —— 菜摆得越多越容易失败
// （失败时云端返回 502 + 「模型没有返回可解析的结果」，重试就过了）。
// 这是云端那条链路的稳定性问题，App 改不了；但「再试一次」正好是我们能做的，
// 而且交给程序重试最合适 —— 用户自己再点一遍，结果和我们重试完全一样，还得多等一次。
// 实测：3 次能把成功率从约三分之一拉到约七成。
const ANALYZE_ATTEMPTS = 3;

// ============================================================
// 同一张照片的「答案缓存」（2026-09-26）
// ============================================================
// 为什么必须有它：
// 模型是概率机器。就算关掉思考、温度调到 0（见云端函数 v6），
// 服务端 MoE 架构 + 批量推理的浮点运算仍可能让两次结果差一点点 ——
// 靠「把模型弄确定」永远到不了 100%。
// 但用户的诉求很简单也很合理：**同一张照片，就该是同一个答案**。
// 那就别为难模型了：记住第一次的结论，同一张照片再来问，就还他这个结论。
//
// 效果：用户连点 3 次「开始分析」，第 2、3 次**瞬间**返回、数字完全一致，
//       不联网、不花钱、也不受网络波动影响。
//
// ⚠️ 照片只要换一张（哪怕对着同一盘菜重拍），指纹就变，不会误命中 ——
//    所以「想让它重新估一次」这个需求照样满足：重新拍一张、或从相册另选一张。
// ⚠️ 缓存的是「AI 原始估算」，**不包含**用户后来改的克数。
//    重新分析 = 回到原始估算，这符合直觉（用户亲手改的东西不该被缓存污染）。
const CACHE_KEY = 'meal.analysis.cache.v1';
const CACHE_MAX = 8; // 只留最近 8 张：够连点，也不占地方

type CacheEntry = { key: string; at: number; data: MealAnalysis };

// 给照片算一个短指纹。
// 不追求加密强度 —— 只要「同一张照片给同一个指纹、不同照片给不同指纹」就够。
// 照片 base64 有几 MB，全量遍历在手机上纯属白等；所以只采样
// 头 / 中 / 尾各 4096 个字符，再带上总长度一起算。
export function photoKey(imageBase64: string, mimeType: string): string {
  const step = 4096;
  const mid = (imageBase64.length / 2) | 0;
  const sample =
    imageBase64.slice(0, step) +
    imageBase64.slice(mid, mid + step) +
    imageBase64.slice(-step);
  return `${mimeType}:${imageBase64.length}:${hash32(sample)}`;
}

// FNV-1a 32 位：够短、够快，而且不需要引入任何加密库。
function hash32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

async function readCache(key: string): Promise<MealAnalysis | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) {
      return null;
    }
    const list = JSON.parse(raw) as CacheEntry[];
    if (!Array.isArray(list)) {
      return null;
    }
    const hit = list.find((e) => e && e.key === key);
    return hit && hit.data ? hit.data : null;
  } catch {
    return null; // 缓存读坏了就当作没有，绝不能因此分析不了
  }
}

async function writeCache(key: string, data: MealAnalysis): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    let list: CacheEntry[] = [];
    try {
      const parsed = raw ? (JSON.parse(raw) as CacheEntry[]) : [];
      if (Array.isArray(parsed)) {
        list = parsed;
      }
    } catch {
      list = [];
    }
    // 新结果放最前，同一张照片的旧记录去掉，只留最近 CACHE_MAX 张。
    const next = [{ key, at: Date.now(), data }, ...list.filter((e) => e && e.key !== key)];
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next.slice(0, CACHE_MAX)));
  } catch {
    // 存不下就算了，下次重新分析即可 —— 缓存失败绝不能影响主流程
  }
}

export async function analyzeMeal(imageBase64: string, mimeType: string): Promise<MealAnalysis> {
  if (!supabase) {
    throw new Error('云端还没配置好，暂时无法分析。');
  }

  // ① 同一张照片先翻缓存：命中就秒回，而且和上次**一模一样**。
  const key = photoKey(imageBase64, mimeType);
  const cached = await readCache(key);
  if (cached) {
    return cached;
  }

  // ② 没命中，才真的去问云端（下面这段带自动重试）。
  let lastMsg = '';
  for (let attempt = 1; attempt <= ANALYZE_ATTEMPTS; attempt++) {
    try {
      // supabase.functions.invoke 会自动带上身份信息，不需要我们手写请求头。
      const { data, error } = await supabase.functions.invoke('analyze-meal', {
        body: { imageBase64, mimeType },
      });
      if (!error) {
        // 云端也可能用 200 回一个 { error } —— 那同样算失败。
        if (
          data &&
          typeof data === 'object' &&
          'error' in data &&
          (data as Record<string, unknown>).error
        ) {
          lastMsg = String((data as Record<string, unknown>).error);
        } else {
          const result = normalizeAnalysis(data);
          // ③ 存下来：这张照片以后再来问，答案就是这一个。
          await writeCache(key, result);
          return result;
        }
      } else {
        lastMsg = await backendMessage(error, error.message || '分析失败，请稍后再试。');
      }
    } catch (e) {
      lastMsg = String((e as Error)?.message ?? e) || '分析失败，请稍后再试。';
    }
    // 两次之间停一下再打：连着猛打更容易又撞上同一个慢响应。
    if (attempt < ANALYZE_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 600 * attempt));
    }
  }
  throw new Error(
    `${lastMsg || '分析失败，请稍后再试。'}（已自动重试 ${ANALYZE_ATTEMPTS} 次）` +
      '菜摆得多的照片，云端容易算不过来 —— 可以少拍几样，或者分两张拍。',
  );
}

// ============================================================
// 用户自己添加食物时，算它的营养
// ============================================================

export type FoodEstimate = {
  // 按「这一份的重量」算好的总量
  calories: number;
  carb: number;
  // 每 100 克的营养 —— 存下来，用户以后改克数就能直接换算，不用重算
  per100: FoodNutrient;
  // 命中的规范名（本地表命中时给，用来告诉用户「按什么算的」）
  matched: string;
  // 数据来源：db = 本地表，ai = 云端模型，fallback = 都没命中，按平均值估的
  from: 'db' | 'ai' | 'fallback';
  // 云端函数还是旧版（只给了糖/油，没给碳水）时为 true。
  // 这时退回平均值，并让界面如实说明原因。
  legacyCloud?: boolean;
};

// 先查本地表（瞬间、不联网、不花钱），查不到再问云端。
// 云端也失败时退回平均值，绝不抛错 —— 用户填完东西加不进去，比数字不准更让人恼火。
export async function estimateFood(name: string, grams: number): Promise<FoodEstimate> {
  const g = Number.isFinite(grams) && grams > 0 ? grams : 0;

  const hit = lookupFood(name);
  if (hit) {
    return {
      ...scaleNutrient(hit.per100, g),
      per100: hit.per100,
      matched: hit.label,
      from: 'db',
    };
  }

  // 本地表没有 -> 问云端
  if (supabase) {
    try {
      const { data, error } = await supabase.functions.invoke('analyze-meal', {
        body: { mode: 'estimate', name, grams: g },
      });
      const ok = !error && data && typeof data === 'object' && !('error' in data && data.error);
      if (ok) {
        const d = data as Record<string, unknown>;
        // 云端还是旧版格式（只有 sugar/fat）：口径不同，不能拿「糖」当碳水用，
        // 否则会给出一个「看着合理其实偏低」的数字。退回平均值并如实说明。
        if (!('per100Carb' in d) && !('carb' in d)) {
          return {
            ...scaleNutrient(FALLBACK_PER100, g),
            per100: FALLBACK_PER100,
            matched: '',
            from: 'fallback',
            legacyCloud: true,
          };
        }
        const per100: FoodNutrient = {
          calories: num(d.per100Calories, num(d.calories, 0)),
          carb: num(d.per100Carb, num(d.carb, 0)),
        };
        // 模型偷懒只给了「这一份」的值时，反推出每 100 克的值。
        if (per100.calories <= 0 && g > 0) {
          per100.calories = round1to1((num(d.calories) / g) * 100);
          per100.carb = round1to1((num(d.carb) / g) * 100);
        }
        if (per100.calories > 0) {
          return {
            ...scaleNutrient(per100, g),
            per100,
            matched: '',
            from: 'ai',
          };
        }
      }
    } catch {
      // 网络不通就走下面的兜底，不要打断用户
    }
  }

  return {
    ...scaleNutrient(FALLBACK_PER100, g),
    per100: FALLBACK_PER100,
    matched: '',
    from: 'fallback',
  };
}

const round1to1 = (n: number) => Math.round(n * 10) / 10;
