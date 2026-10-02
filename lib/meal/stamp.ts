// 时间戳和"画面摆多大"这两件纯计算。
//
// 单独一个文件、不碰任何原生模块，是为了能脱离手机直接做测试 ——
// 水印最容易出的两个毛病（时间写成 "2026-9-6"、照片被拉变形），
// 都能在这里一遍遍跑出来，不用真去拍几百张照片。

// 照片右下角那行字：2026-09-26 21:19:07
// 月和日补零到两位，是为了宽度固定 —— 不然「9-6」和「12-31」长短不一，
// 一叠照片看下来会显得参差不齐。
//
// ★ 为什么要精确到**秒**（2026-09-26 夜用户定）：
//   原话「要精确到秒，因为用户可能在 1 分钟之内重拍的」。
//   相册里同一餐会躺着好几张几乎一样的照片（App 永不删相册照片，见 album.ts），
//   分辨"哪张先拍、哪张后拍"全靠这行字。只到分钟的话，
//   一分钟内重拍的两张会印着一模一样的时间 —— 那就等于没有线索。
export function stampText(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 算出"这块画面该摆多大"。
//
// 两条硬要求：
//   1. **比例必须和原照片一模一样**（宽高同乘一个数），不然照片会被拉扁拉长
//   2. **只缩不放**。原图比屏幕小的时候就按原样摆，放大只会更糊
//
// maxW / maxH 是屏幕能给的空间。
export function fitBox(
  w: number,
  h: number,
  maxW: number,
  maxH: number,
): { boxW: number; boxH: number } {
  // 尺寸不正常（0、负数、NaN）时给一个最小可用的方框，让流程能走下去。
  if (!(w > 0) || !(h > 0) || !(maxW > 0) || !(maxH > 0)) {
    return { boxW: 1, boxH: 1 };
  }
  const k = Math.min(maxW / w, maxH / h, 1);
  return {
    boxW: Math.max(1, Math.round(w * k)),
    boxH: Math.max(1, Math.round(h * k)),
  };
}
