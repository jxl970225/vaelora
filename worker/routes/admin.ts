import { Hono } from 'hono';
import { issueToken } from '../lib/auth';
import { sha256Hex, timingSafeEqual } from '../lib/crypto';

export const admin = new Hono<{ Bindings: Env }>();

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
  // 配置缺失时直接说清楚，不要让 undefined 参与哈希运算 ——
  // 那样会返回一个看起来像"密码错误"的 401，能查很久才发现是根本没配。
  const missing = (['ADMIN_USER', 'ADMIN_PASSWORD_HASH', 'SESSION_SECRET'] as const).filter(
    (key) => !c.env[key]
  );
  if (missing.length > 0) {
    return c.json({ error: `服务端未配置：${missing.join('、')}` }, 500);
  }

  const body = await c.req
    .json<{ username?: string; password?: string }>()
    .catch(() => ({}) as { username?: string; password?: string });

  const ok = await credentialsMatch(c.env, body.username ?? '', body.password ?? '');

  if (!ok) {
    // 统一文案，不告诉对方是账号错还是密码错
    return c.json({ error: '账号或密码错误' }, 401);
  }

  return c.json({ token: await issueToken(c.env.SESSION_SECRET) });
});
