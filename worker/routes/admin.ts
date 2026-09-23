import { Hono } from 'hono';
import { issueToken } from '../lib/auth';
import { sha256Hex, timingSafeEqual } from '../lib/crypto';

export const admin = new Hono<{ Bindings: Env }>();

/** sha256 的十六进制表示恒为 64 位 */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * 检查配置是否可用。
 *
 * 分两层：先看变量在不在，再看值的形态对不对。
 * 只查"在不在"是不够的 —— 把明文密码填进 ADMIN_PASSWORD_HASH 也能通过，
 * 然后卡在 401「账号或密码错误」，看着像密码输错了，实际是配置形态错了。
 */
function configProblem(env: Env): string | null {
  const missing = (['ADMIN_USER', 'ADMIN_PASSWORD_HASH', 'SESSION_SECRET'] as const).filter(
    (key) => !env[key]?.trim()
  );
  if (missing.length > 0) return `服务端未配置：${missing.join('、')}`;

  // 从终端复制粘贴很容易带上尾部换行，这里统一去掉再判断
  const hash = env.ADMIN_PASSWORD_HASH.trim().toLowerCase();
  if (!SHA256_HEX.test(hash)) {
    return (
      `ADMIN_PASSWORD_HASH 格式不对：应该是 64 位十六进制的 sha256，` +
      `当前是 ${hash.length} 位。用 npm run hash-password -- 你的密码 生成后重新粘贴。`
    );
  }

  return null;
}

/** 两个值都先哈希再比较：长度一致，比较才是定长的，也不泄露用户名是否存在 */
async function credentialsMatch(env: Env, username: string, password: string): Promise<boolean> {
  const [userGiven, userExpected] = await Promise.all([
    sha256Hex(username),
    sha256Hex(env.ADMIN_USER.trim()),
  ]);
  const [passGiven, passExpected] = await Promise.all([
    sha256Hex(password),
    // 环境变量里存的就是哈希，不再存明文
    Promise.resolve(env.ADMIN_PASSWORD_HASH.trim().toLowerCase()),
  ]);

  const userOk = timingSafeEqual(userGiven, userExpected);
  const passOk = timingSafeEqual(passGiven, passExpected);
  // 不短路，两个都算完再返回，避免通过耗时区分是哪一项错了
  return userOk && passOk;
}

admin.post('/login', async (c) => {
  const problem = configProblem(c.env);
  if (problem) return c.json({ error: problem }, 500);

  const body = await c.req
    .json<{ username?: string; password?: string }>()
    .catch(() => ({}) as { username?: string; password?: string });

  const ok = await credentialsMatch(c.env, body.username ?? '', body.password ?? '');

  if (!ok) {
    // 统一文案，不告诉对方是账号错还是密码错
    return c.json({ error: '账号或密码错误' }, 401);
  }

  return c.json({ token: await issueToken(c.env.SESSION_SECRET.trim()) });
});
