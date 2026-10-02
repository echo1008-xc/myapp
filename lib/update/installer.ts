import { File, Paths } from 'expo-file-system';

export type DownloadProgressInfo = {
  received: number; // 已下载字节
  total: number; // 总字节；服务器没给大小会是 -1
  percent: number | null; // 0~1；拿不到总大小就是 null，界面改成"转圈"
};

export type InstallResult = 'launched' | 'failed';

// 把安装包下到手机的缓存目录（系统会自动清理，不占你相册/文档）。
// idempotent: true = 重复点「更新」直接覆盖旧文件，不会报"文件已存在"。
export async function downloadApk(
  url: string,
  onProgress?: (info: DownloadProgressInfo) => void,
): Promise<File> {
  const target = new File(Paths.cache, 'myapp-update.apk');
  return await File.downloadFileAsync(url, target, {
    idempotent: true,
    onProgress: ({ bytesWritten, totalBytes }) => {
      onProgress?.({
        received: bytesWritten,
        total: totalBytes,
        percent: totalBytes > 0 ? bytesWritten / totalBytes : null,
      });
    },
  });
}

// 把手机里这个 apk 交给安卓的「安装」界面。
//
// ⚠️ 这里没法真正"静默安装"：安卓从 8.0 起强制要求用户亲手点一下系统的
// 「安装」按钮，任何 App 都绕不过去（这是系统级安全设计，不是我们偷懒）。
// 我们能做的是：把安装界面直接顶到用户面前，省掉"去文件管理器找安装包"这一步。
export async function installApk(file: File): Promise<InstallResult> {
  try {
    // 动态 import：万一某个包还没拿到这个原生模块（比如老安装包），
    // 这里会抛错被 catch 住，界面退化成"用浏览器下载"，而不是整个 App 崩掉。
    const IntentLauncher = await import('expo-intent-launcher');
    // contentUri 是安卓专用的"共享给外部程序"的地址；拿不到就用普通 file 地址。
    const data = file.contentUri || file.uri;
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data,
      type: 'application/vnd.android.package-archive',
      flags: 1, // = FLAG_GRANT_READ_URI_PERMISSION，把读这个文件的权限临时借给安装器
    });
    return 'launched';
  } catch {
    return 'failed';
  }
}
