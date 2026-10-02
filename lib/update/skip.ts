import AsyncStorage from '@react-native-async-storage/async-storage';

// 用户点过「稍后」的版本号，记在这。
// 下次开 App 不再为同一个版本弹窗（但设置页手动点「检查更新」还是会提示）。
// 用 versionCode 这个整数而不是 "1.2.0" 字符串，比对简单、也不会被格式差异坑到。
const KEY = 'update:skipped-version-code';

export async function getSkippedVersionCode(): Promise<number> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v ? Number(v) || 0 : 0;
  } catch {
    return 0;
  }
}

export async function setSkippedVersionCode(code: number): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, String(code));
  } catch {
    // 实在存不上就算了：大不了下次开 App 再提醒一次，不影响功能。
  }
}
