import AsyncStorage from '@react-native-async-storage/async-storage';

// 拍照时间戳的策略（2026-09-28 艾可定）：
//   照片上到底打不打 App 自己的时间水印，由这个开关决定。
//
//   'auto'   —— 默认。照片本身已经带了拍摄时间（相机/系统记的 EXIF 时间）就不打，
//              没有才打。对上艾可说的「系统有时间戳你就不打、没有你就打」。
//   'always' —— 永远打（旧行为，App 自己盖一个精确到秒的时间）。
//   'never'  —— 永远不打（相机已自带时间水印、想完全交给相机时用）。
//
// 为什么要给个手动开关：自动判断靠「照片有没有 EXIF 拍摄时间」来猜，
// 绝大多数相机都带，但极个别情况会被相机剥掉 EXIF、或用户就是想要 App 的秒级时间 ——
// 这时手动切一下就行，不必再来找我改代码。
export type WatermarkMode = 'auto' | 'always' | 'never';

const KEY = 'myapp.watermarkMode';
let cache: WatermarkMode | null = null;

export async function getWatermarkMode(): Promise<WatermarkMode> {
  if (cache) return cache;
  try {
    const v = await AsyncStorage.getItem(KEY);
    cache = v === 'always' || v === 'never' ? v : 'auto';
  } catch {
    // 读不到就用默认，不影响拍照
    cache = 'auto';
  }
  return cache;
}

export async function setWatermarkMode(m: WatermarkMode): Promise<void> {
  cache = m;
  try {
    await AsyncStorage.setItem(KEY, m);
  } catch {
    /* 存不住就先留在内存里，下次进设置还能改 */
  }
}

// 照片的 EXIF 里有没有"拍摄时间"。有 → 说明是相机拍的、时间已经被记下来了
// （相机开启时间水印时，画面里也烤进了时间），App 就不必再叠一层。
export function hasCaptureTimestamp(
  exif?: Record<string, any> | null,
): boolean {
  if (!exif) return false;
  const dateKeys = [
    'DateTimeOriginal',
    'DateTimeDigitized',
    'DateTime',
    'CreateDate',
    'ModifyDate',
  ];
  return dateKeys.some((k) => {
    const v = exif[k];
    return v != null && String(v).trim() !== '';
  });
}

// 算出这一张照片该不该打 App 水印。
export function shouldStamp(
  mode: WatermarkMode,
  exif?: Record<string, any> | null,
): boolean {
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  // auto：照片自身已带拍摄时间 → 不打；否则打
  return !hasCaptureTimestamp(exif);
}
