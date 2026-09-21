import { Hono } from 'hono';
import { issueToken } from '../lib/auth';
import { hashIp, sha256Hex, timingSafeEqual } from '../lib/crypto';

export const admin = new Hono<{ Bindings: Env }>();

const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

/** 两个值都先哈希再比较：长度一致，比较才是定长的，也不泄露用户名是否存在 */
async function credentialsMatch(env: Env, username: string, password: string): Promise<boolean> {
  const [userGiven, userExpected] = await Promise.all([
    sha256Hex(username),
    sha256Hex(env.ADMIN_USER),
  ]);
  const [passGiven, passExpected] = await Promise.all([
    sha256Hex(password),
    // 环境变量里存的就是哈希，不再存明文
    Promise.resolve(env.ADMIN_PASSWORD_HASH.toLowerCase()),
  ]);

  const userOk = timingSafeEqual(userGiven, userExpected);
  const passOk = timingSafeEqual(passGiven, passExpected);
  // 不短路，两个都算完再返回，避免通过耗时区分是哪一项错了
  return userOk && passOk;
}

admin.post('/login', async (c) => {
  const ipHash = await hashIp(c.req.header('cf-connecting-ip') ?? 'unknown', c.env.IP_SALT);
  const since = Date.now() - FAILURE_WINDOW_MS;

  const failures = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM login_attempts
      WHERE ip_hash = ? AND attempted_at > ? AND succeeded = 0`
  )
    .bind(ipHash, since)
    .first<{ n: number }>();

  // 没有这层，登录接口就是一个可以无限次尝试的密码预言机
  if ((failures?.n ?? 0) >= MAX_FAILURES) {
    return c.json({ error: '尝试次数过多，请 15 分钟后再试' }, 429);
  }

  const body = await c.req
    .json<{ username?: string; password?: string }>()
    .catch(() => ({}) as { username?: string; password?: string });

  const ok = await credentialsMatch(c.env, body.username ?? '', body.password ?? '');

  await c.env.DB.prepare(
    `INSERT INTO login_attempts (ip_hash, attempted_at, succeeded) VALUES (?, ?, ?)`
  )
    .bind(ipHash, Date.now(), ok ? 1 : 0)
    .run();

  if (!ok) {
    // 统一文案，不告诉对方是账号错还是密码错
    return c.json({ error: '账号或密码错误' }, 401);
  }

  return c.json({ token: await issueToken(c.env.SESSION_SECRET) });
});
