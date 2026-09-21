import { timingSafeEqual } from './crypto';

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 小时

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return base64url(new Uint8Array(signature));
}

/**
 * 自签的会话 token：`过期时间戳.HMAC签名`。
 * 服务端无状态，不需要存 session 表。
 */
export async function issueToken(secret: string, now = Date.now()): Promise<string> {
  const expiresAt = String(now + TOKEN_TTL_MS);
  return `${expiresAt}.${await sign(secret, expiresAt)}`;
}

export async function verifyToken(
  secret: string,
  token: string,
  now = Date.now()
): Promise<boolean> {
  const [expiresAt, signature] = token.split('.');
  if (!expiresAt || !signature) return false;

  const expires = Number(expiresAt);
  if (!Number.isFinite(expires) || expires < now) return false;

  // 定长比较，避免通过响应时间逐字节猜签名
  return timingSafeEqual(await sign(secret, expiresAt), signature);
}
