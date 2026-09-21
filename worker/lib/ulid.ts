const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Crockford Base32 的 ULID：前 10 位时间戳 + 后 16 位随机。
 * 字典序 == 时间序，所以画廊分页可以直接用 `WHERE id < ?` 做 keyset 分页，
 * 不需要 OFFSET（SQLite 上 OFFSET 在大表里会退化成全表扫描）。
 */
export function ulid(now = Date.now()): string {
  let time = now;
  let timestamp = '';
  for (let i = 0; i < 10; i++) {
    timestamp = ENCODING[time % 32] + timestamp;
    time = Math.floor(time / 32);
  }

  const random = crypto.getRandomValues(new Uint8Array(16));
  let suffix = '';
  for (let i = 0; i < 16; i++) {
    suffix += ENCODING[random[i] % 32];
  }

  return timestamp + suffix;
}
