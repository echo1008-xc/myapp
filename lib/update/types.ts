// 「App 内更新」的公共类型。字段和云端 app_releases 表一一对应。
//
// 两个版本号的分工（别搞混）：
//   version     —— 给你看的，像 "1.2.0"
//   versionCode —— 给机器比的，是个整数，像 3。安卓系统认这个，比大小最可靠。
// 两者都在 app.json 里，每次发新包一起往上加。

export type ReleaseInfo = {
  version: string;
  versionCode: number;
  apkUrl: string;
  notes: string;
  force: boolean;
};

export type LocalVersion = {
  version: string;
  versionCode: number;
};

// 一次「检查更新」的五种结局，页面按这个分别显示。
export type UpdateCheck =
  | { status: 'disabled' } // 云端没配，跳过检查
  | { status: 'latest'; current: LocalVersion } // 真的比过了，确实是最新
  // 云端表里一条记录都没有（或记录没填下载地址）→ 无从比较。
  // 必须和 'latest' 分开：说"已是最新"是在骗人，实际是"我还不知道"。
  | { status: 'unconfigured'; current: LocalVersion }
  | { status: 'available'; current: LocalVersion; release: ReleaseInfo } // 有新版
  | { status: 'error'; message: string }; // 网络/表不存在之类
