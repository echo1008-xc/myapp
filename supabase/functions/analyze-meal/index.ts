// ============================================================
// 云函数：analyze-meal —— 拍照识别食物 + 估算营养
// ============================================================
// 2026-10-10 简化（用户决策）：
//   · 去掉「跨用户云端缓存」—— 不同人拍不出一样的照片，近似匹配的命中率近零，
//     却让每次分析都多一次数据库查询（~0.34s），纯属浪费。App 端本机已有
//     「同一张照片秒回」的缓存，够用。
//   · 去掉「云端登录令牌校验」—— 登录已在 App 端拦截；无限分析的风险由
//     「每餐分析限额」（后期在 App 内实现）兜底，云端不再做令牌校验。
//   · 图片压缩在【客户端上传前】做（App 端把照片压到 768 长边再传），
//     上传体积小、喂给模型的数据量也小，既快又省。云端不缩放。
//
// 2026-10-11 恢复营养数值：10-10 改成模型只回「名字+克数」、营养全靠 App 本地算，
//   但 1.2.5 的老 App 没有本地算的逻辑（且因原生底座差异无法热更修复），
//   表现为「热量碳水全部 0」。恢复让模型直接返回整份热量/碳水；
//   新版 App 仍优先本地库，云端值只在本地库没收录时兜底 —— 新旧两端同时兼容。
//
// 2026-10-12 优化（v10-12-opt）：
//   · 恢复「细化说明」字段 note：模型对【被遮挡 / 不完整 / 拿不准 / 容易认错】的食材，
//     写一句简短说明（如「内馅未知，暂按肉包子估」）；确定且常见的食物 note 留空。
//     10-10/10-11 重写函数时把 note 字段弄丢了，导致 App 端出现「份量未知」占位。
//     App 端（v1012h 起）已能从 r.note 直接显示这一行。
//   · 提速：prompt 精简、明确要求一次性输出紧凑 JSON、不解释不重复；
//     调模型时加 max_tokens 上限，防止模型因冗长输出拖慢响应。
//     想更快可在控制台把 VISION_MODEL 换成更快的模型（如 deepseek-flash 已较快）。
//
// 契约（与 App 端 lib/meal/api.ts 对齐）：
//   入参（photo）：{ imageBase64, mimeType, token? }
//   入参（estimate）：{ mode: 'estimate', name, grams, token? }
//   出参（photo）：{ items:[{name,grams,calories,carb,note}], summary, confidence, scale }
//   出参（estimate）：{ per100Calories, per100Carb, calories?, carb? }
//   错误：统一返回 { error: '中文说明' }
//
// 视觉模型：OpenAI 兼容接口（chat + 图片），通过环境变量切换供应商。
//   VISION_API_URL   默认 https://api.openai.com/v1/chat/completions
//   VISION_API_KEY   必填（不设 → 返回明确错误，不崩）
//   VISION_MODEL     默认 gpt-4o-mini
//   DAILY_CALL_CAP   可选，每日模型调用上限（软上限，0/不设为不限制）
//
// 部署：npx supabase functions deploy analyze-meal
// 环境变量在 Supabase 控制台 → Project Settings → Edge Functions 里加。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}

const supabase = () =>
  createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

// 视觉模型供应商配置。
// 密钥回退：旧版函数用的变量名是 DEEPSEEK_API_KEY（云端 Secrets 里实际存的名字），
// 新版统一叫 VISION_API_KEY。为了不用重新填一遍密钥，读不到新名就回退旧名。
// 端点/模型默认值跟着回退：这个 key 是 DeepSeek 官方多模态 key，直接用官方接口与视觉模型。
const USE_LEGACY_KEY = !Deno.env.get('VISION_API_KEY') && !!Deno.env.get('DEEPSEEK_API_KEY');
const API_URL = (Deno.env.get('VISION_API_URL') || (USE_LEGACY_KEY ? 'https://api.deepseek.com/chat/completions' : 'https://api.openai.com/v1/chat/completions')).trim();
const API_KEY = (Deno.env.get('VISION_API_KEY') || Deno.env.get('DEEPSEEK_API_KEY') || '').trim();
const MODEL = (Deno.env.get('VISION_MODEL') || (USE_LEGACY_KEY ? 'deepseek-flash' : 'gpt-4o-mini')).trim();
const DAILY_CAP = Math.max(0, Number(Deno.env.get('DAILY_CALL_CAP') || '0') || 0);

// 模型单次输出上限：防止模型因冗长（长 summary / 长 note / 废话）拖慢响应。
// 一张图通常 3~6 项，每项 name+note 很短，1200 token 绰绰有余。
const MAX_TOKENS = 1200;

// ---------- 调视觉模型（OpenAI 兼容，chat + 图片）----------
async function callVisionModel(dataUrl: string): Promise<any> {
  if (!API_KEY) {
    throw new Error('云端还没配置视觉模型（VISION_API_KEY），暂不可用');
  }
  const system = [
    '你是「餐盘食物识别」助手。用户会发一张餐盘照片。',
    '识别照片里每样食物，给每项：食物名称 / 重量(克) / 这一份热量(千卡) / 这一份碳水(克) / 说明(note)。',
    '硬性要求：',
    '1) grams 是这一项估算重量(克)，拿不准给常见份量(如 150)。',
    '2) calories、carb 按【这一项整份】算(不是每100克)，按常见中式家常做法估；拿不准也必须给数，不许返回 0。',
    '3) 照片有尺寸参照物(筷子/勺/手机/硬币/鸡蛋/手掌)就写进 scale；没有写「无参照物」。',
    '4) confidence 按照片清晰度与份量可判度给 low / medium / high。',
    '5) summary 用一句中文点评这顿饭份量/种类。',
    '6) note：对「被遮挡、不完整、拿不准、易认错」的食材写一句简短说明(不超过20字，如「内馅未知，暂按肉包子估」「部分被遮挡，按常见份量估」)；确定且常见的食物 note 留空字符串 ""。',
    '只输出如下 JSON，不要任何其它文字：',
    '{"items":[{"name":"食物名","grams":0,"calories":0,"carb":0,"note":""}],"summary":"","confidence":"medium","scale":"无参照物"}',
  ].join('\n');

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: MAX_TOKENS,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: '请分析这张餐盘照片。' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`视觉模型接口错误 ${res.status}：${t.slice(0, 200)}`);
  }
  const j = await res.json().catch(() => null);
  const content = j?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('模型没有返回可解析的结果');
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new Error('模型返回的不是合法 JSON');
  }
}

// 只问一种食物的「每 100 克」营养（estimate 模式用，不传图片）。
async function callEstimateModel(name: string): Promise<{ per100Calories: number; per100Carb: number }> {
  if (!API_KEY) {
    throw new Error('云端还没配置视觉模型（VISION_API_KEY），暂不可用');
  }
  const prompt = `你是营养数据库助手。请给出「${name}」每 100 克的热量（千卡）和碳水化合物（克）。
只输出 JSON：{"per100Calories":0,"per100Carb":0}，不要其它文字。`;
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: prompt }],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`视觉模型接口错误 ${res.status}：${t.slice(0, 200)}`);
  }
  const j = await res.json().catch(() => null);
  const content = j?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('模型没有返回可解析的结果');
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new Error('模型返回的不是合法 JSON');
  }
}

// 每日调用计数 +1，返回最新值（软上限用）。DAILY_CALL_CAP 为 0 时直接返回 0，不碰数据库。
async function incQuota(db: ReturnType<typeof supabase>): Promise<number> {
  if (DAILY_CAP <= 0) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await db.rpc('meal_usage_inc', { p_day: today }).single();
  return Number(data || 0);
}

// 模型回 name + grams + calories + carb + note（10-11 恢复营养；10-12 恢复 note）。
// 把结果轻度规整，缺字段一律按 0 / 空串（App 端有自己的兜底）。
function sanitizePhotoResult(raw: any): any {
  const items = (Array.isArray(raw?.items) ? raw.items : [])
    .map((i: any) => ({
      name: typeof i?.name === 'string' ? i.name.trim() : '',
      grams: Number(i?.grams) || 0,
      calories: Math.max(0, Math.round(Number(i?.calories) || 0)),
      carb: Math.max(0, Math.round(Number(i?.carb) || 0)),
      note: typeof i?.note === 'string' ? i.note.trim().slice(0, 40) : '',
    }))
    .filter((i: any) => i.name);
  return {
    items,
    summary: typeof raw?.summary === 'string' ? raw.summary : '',
    confidence: raw?.confidence === 'low' || raw?.confidence === 'high' ? raw.confidence : 'medium',
    scale: typeof raw?.scale === 'string' ? raw.scale : '无参照物',
  };
}

// ---------- 入口 ----------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }
  if (req.method !== 'POST') {
    return json({ error: '只接受 POST' }, 405);
  }

  const db = supabase();
  const t0 = Date.now();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: '请求格式不对' }, 400);
  }

  if (body?.mode === 'estimate') {
    return await handleEstimate(db, body, t0);
  }
  return await handlePhoto(db, body, t0);
});

async function handlePhoto(db: ReturnType<typeof supabase>, body: any, t0 = Date.now()): Promise<Response> {
  const imageBase64 = String(body?.imageBase64 ?? '');
  const mimeType = String(body?.mimeType ?? 'image/jpeg');

  if (!imageBase64) {
    return json({ error: '没有收到图片' }, 400);
  }
  // 约 11MB base64 ≈ 8MB 原图，超过就挡下，保护边缘函数内存。
  if (imageBase64.length > 15_000_000) {
    return json({ error: '图片太大了，换小一点的再试' }, 413);
  }

  // 成本闸门：跨过才真正调模型（无上限时直接过）。
  const used = await incQuota(db);
  if (DAILY_CAP > 0 && used > DAILY_CAP) {
    return json({ error: '今日分析额度已用完，明天再来' }, 429);
  }

  const dataUrl = `data:${mimeType};base64,${imageBase64}`;
  let raw: any;
  try {
    raw = await callVisionModel(dataUrl);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    // 模型内容失败：200 + {error}，让 App 端走重试逻辑（和旧版一致）。
    return json({ error: msg || '模型没有返回可解析的结果' });
  }
  if (!raw || !Array.isArray(raw.items)) {
    return json({ error: '模型没有返回可解析的结果' });
  }

  const result = sanitizePhotoResult(raw);
  console.log('[timing] model done +', Date.now() - t0, 'ms');
  return json(result);
}

async function handleEstimate(db: ReturnType<typeof supabase>, body: any, t0 = Date.now()): Promise<Response> {
  const name = String(body?.name ?? '').trim();
  const grams = Number(body?.grams) || 0;
  if (!name) {
    return json({ error: '没收到食物名' }, 400);
  }

  const used = await incQuota(db);
  if (DAILY_CAP > 0 && used > DAILY_CAP) {
    return json({ error: '今日分析额度已用完，明天再来' }, 429);
  }

  let res: { per100Calories: number; per100Carb: number };
  try {
    res = await callEstimateModel(name);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    return json({ error: msg || '模型没有返回可解析的结果' });
  }
  const per100Calories = Number(res?.per100Calories) || 0;
  const per100Carb = Number(res?.per100Carb) || 0;
  const out = {
    per100Calories,
    per100Carb,
    calories: Math.round((per100Calories * grams) / 100),
    carb: Math.round((per100Carb * grams) / 100),
  };
  console.log('[timing] est model done +', Date.now() - t0, 'ms');
  return json(out);
}
