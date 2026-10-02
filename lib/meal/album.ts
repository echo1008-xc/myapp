// 把拍好的餐盘照片存进**手机相册**，而不是留在 App 自己的目录里。
//
// 为什么要单独一个文件、而且用「用到才加载」的写法：
// expo-media-library 是一个**原生模块**，老安装包（1.2.3）里根本没有它。
// 如果这里写一句顶格的 import，那份代码一旦以任何方式进了老 App，
// 打开餐盘页就会直接白屏。动态导入失败就返回 null，退化成
// 「存不了相册，但拍照、分析、记账照常」，绝不崩。
//
// 存在相册而不是 App 里，好处：
//   1. App 不再攒照片（以前每拍一张都在 App 目录里留下 2~3 MB，一直堆着）
//   2. 换手机、重装 App 也丢不了 —— 照片本来就在你相册里
//   3. 用别的看图软件直接就能看，不依赖本 App
//   4. ★ 相册里留着这一餐**拍过的每一个版本**，想换回上一张随时能导回来
//
// ⚠️⚠️ 两条死规矩，改这个文件之前必须先读：
//
//   ① **App 永远不删除相册里的照片。**
//      2026-09-26 深夜用户定：「每一餐只能拍一张照片，重拍可以把记录顶掉，
//      但是头一次存在相册里的照片不要删 —— 因为后期用户还想从相册导入
//      换成前面一张，让他也可以办得到。」
//      → 所以这里**没有**、也**不要**再加删除函数。账本那边顶掉旧记录时，
//        相册里那张原封不动地留着，它就是"历史版本"。
//      → 用户在相册里自己删了某张，App 也管不着，顶多回看时那张图打不开
//        （界面已经能优雅退化，见 meal.tsx 的 photoGone）。
//
//   ② expo-media-library 在 SDK 57 换了一整套新接口。老的
//      `createAssetAsync` / `deleteAssetsAsync` **虽然还挂在主入口上，
//      但调用时会直接抛异常**（官方注释原文："This method will throw in runtime"）。
//      照老写法写「存进相册」，照片会**永远存不进去**，而因为外面包着
//      try/catch，它会安静地失败 —— 真机上表现为「相册里翻不到照片」，极难查。
//      → 现在用的是新的：`Asset.create(文件路径)`。

type MediaLibraryModule = typeof import('expo-media-library');

// 加载过一次就记住结果：要么拿到模块，要么明确知道"这台设备/这个包里没有"。
let pending: Promise<MediaLibraryModule | null> | null = null;

function loadMediaLibrary(): Promise<MediaLibraryModule | null> {
  if (!pending) {
    pending = import('expo-media-library').catch(() => null);
  }
  return pending;
}

// 存进相册。成功返回**这张图在相册里的位置**（用来显示），失败返回 null。
// 失败一律不抛异常：调用方只看"拿到没有"，不用到处写 try/catch。
export async function savePhotoToAlbum(fileUri: string): Promise<string | null> {
  const ML = await loadMediaLibrary();
  if (!ML) {
    return null;
  }
  try {
    // 申请相册权限。这里要的是「读写」而不是「只写」：
    // 照片存进去之后，回看时还要从相册里把它读出来显示。
    // 少要这一项权限的话，会出现「存得进去、点开却是一片空白」。
    const perm = await ML.requestPermissionsAsync();
    if (!perm.granted) {
      return null;
    }
    const asset = await ML.Asset.create(fileUri);
    if (!asset?.id) {
      return null;
    }
    // 显示要用的是**文件路径**，得另外问它要。
    // （asset.id 是相册内部编号 —— 我们**不需要**它了：既然不删照片，
    //   就没有任何地方要用编号去认某一张。少存一个字段，少一分误删的可能。）
    let uri: string | null = null;
    try {
      uri = await asset.getUri();
    } catch {
      uri = null;
    }
    // 极少数机型上 getUri 拿不到，这时退回传进来的那个路径 ——
    // 照片**已经在相册里**了（上面 create 成功过），只是这次没拿到它的新地址。
    // 宁可这一次仍用临时文件显示，也不能把"已经存进去了"当成失败。
    return uri || fileUri;
  } catch (e) {
    // 存储满了、系统不给、机型差异…… 一律当作"没存上"，退回用临时文件。
    // 记一条日志：这一句是排查「相册里翻不到照片」时的唯一线索，
    // 别删（用户报这个现象时，要先看这里有没有刷屏）。
    console.warn('[album] 照片没能存进相册，改用临时文件：', e);
    return null;
  }
}
