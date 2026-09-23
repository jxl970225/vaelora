/**
 * R2 存储约定 —— 结构是固定的，不存在数据库里：
 *
 *   {桶根}/
 *     ├── 1.jpg … 8.jpg     一级：主题封面，文件名就是主题号
 *     ├── 1/                二级：主题 1 的图片
 *     │   ├── 1-1.jpg
 *     │   └── 1-2.jpg
 *     └── …
 *
 * 「有哪些图」直接由列目录得出，不需要额外的索引。
 */

/** 一级封面：{主题号}.{扩展名} */
export function coverPrefix(index: number): string {
  return `${index}.`;
}

/** 二级图片所在目录：{主题号}/ */
export function themePrefix(index: number): string {
  return `${index}/`;
}

/** 二级图片命名：{主题号}-{序号}.{扩展名} */
export function imageKey(index: number, seq: number, ext = 'jpg'): string {
  return `${index}/${index}-${seq}.${ext}`;
}

/**
 * 图片的对外 URL。
 *
 * 配了 R2 自定义域名就走直连（CDN 缓存，不消耗 Worker 请求）；
 * 没配则回落到 Worker 代理 —— 本地开发就是这条路径。
 */
export function publicUrl(env: Env, key: string): string {
  const base = env.IMAGE_BASE_URL?.trim();
  if (base) return `${base.replace(/\/+$/, '')}/${key}`;
  return `/api/file/${key}`;
}

/**
 * 翻页取完某个前缀下的全部对象。
 *
 * 必须显式带上 `include: ['customMetadata']` —— R2 的 list 默认不返回自定义
 * 元数据，不写的话图片宽高读出来全是 null，前端就不能预留正确比例了。
 *
 * 另外：带 include 时单次返回的条数可能少于 limit（总量有限制），
 * 所以翻页判断只认 `truncated`，不能拿返回条数和 limit 比较。
 */
export async function listAll(bucket: R2Bucket, prefix: string): Promise<R2Object[]> {
  const objects: R2Object[] = [];
  let cursor: string | undefined;

  do {
    // `include` 在运行时是支持的（已实测能取到 customMetadata），
    // 但当前装的 @cloudflare/workers-types@4.20260702.1 类型定义里还没这个字段，
    // 所以这里断言一下。升级 workers-types 后可以去掉。
    const options = {
      prefix,
      cursor,
      limit: 1000,
      include: ['customMetadata'],
    } as R2ListOptions;

    const page = await bucket.list(options);
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return objects;
}

/** `1/1-7.jpg` → 7。解析不出来返回 0。 */
export function seqFromKey(key: string, index: number): number {
  const match = new RegExp(`^${index}/${index}-(\\d+)\\.[^.]+$`).exec(key);
  return match ? Number(match[1]) : 0;
}

/**
 * 下一个序号 = 当前最大序号 + 1。
 *
 * 靠列目录推出来，没有数据库的原子计数器。**两个人同时上传会撞号**
 * （都读到同一个最大值）。单人管理时这个窗口不存在。
 */
export async function nextSeq(bucket: R2Bucket, index: number): Promise<number> {
  const objects = await listAll(bucket, themePrefix(index));
  let max = 0;
  for (const object of objects) {
    max = Math.max(max, seqFromKey(object.key, index));
  }
  return max + 1;
}
