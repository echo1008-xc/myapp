import Constants from 'expo-constants';
import { isCloudEnabled, supabase } from '../supabase';
import type { LocalVersion, ReleaseInfo, UpdateCheck } from './types';

// 本机正在跑的版本号：直接读 app.json 里的 build 结果，不用手写一份（免得两处对不上）。
export function getLocalVersion(): LocalVersion {
  const cfg = Constants.expoConfig;
  return {
    version: cfg?.version ?? '0.0.0',
    versionCode: Number(cfg?.android?.versionCode ?? 0),
  };
}

// "1.10.0" 应该比 "1.9.0" 新 —— 直接比字符串会得出相反结论，
// 所以拆成一段一段按数字比。
export function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) {
      return x - y;
    }
  }
  return 0;
}

// 问云端：这个安卓 App 有没有比我新的版本？
export async function checkForUpdate(): Promise<UpdateCheck> {
  if (!isCloudEnabled || !supabase) {
    return { status: 'disabled' };
  }
  const current = getLocalVersion();

  try {
    const { data, error } = await supabase
      .from('app_releases')
      .select('version, version_code, apk_url, notes, force_update')
      .eq('platform', 'android')
      .order('version_code', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return { status: 'error', message: error.message };
    }
    if (!data) {
      // 表里还没登记任何版本 —— 这是"我不知道有没有新版"，
      // 不能报成"已是最新"（那是在骗用户，会让人误以为没得更新而放弃）。
      return { status: 'unconfigured', current };
    }

    const release: ReleaseInfo = {
      version: String(data.version ?? ''),
      versionCode: Number(data.version_code ?? 0),
      apkUrl: String(data.apk_url ?? ''),
      notes: String(data.notes ?? ''),
      force: Boolean(data.force_update),
    };
    // 没填下载地址 = 这条记录还不能用，别弹窗（否则用户点了没反应）。
    // 同样属于"信息不全"，不能报"已是最新"。
    if (!release.apkUrl) {
      return { status: 'unconfigured', current };
    }

    // 两边都有整数版本号就比整数（可靠）；缺了就退回比 "1.2.0" 这种字符串。
    const isNewer =
      release.versionCode > 0 && current.versionCode > 0
        ? release.versionCode > current.versionCode
        : compareVersion(release.version, current.version) > 0;

    return isNewer ? { status: 'available', current, release } : { status: 'latest', current };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : '网络好像不太通' };
  }
}
