#!/usr/bin/env bash
#
# vaelora 部署脚本
#
#   ./scripts/deploy.sh           完整流程：检查 → 设 secret → 部署
#   ./scripts/deploy.sh --check    只做检查，不改动任何东西
#
# 幂等的：已设的 secret 不会覆盖，重复执行安全。
#
# 注意这里**没有数据库**——图片直接按固定结构存在 R2 里
#   {主题号}.jpg          一级：主题封面
#   {主题号}/{主题号}-{序号}.jpg   二级：该主题的图片
# 所以不需要建库、不需要迁移。

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

CONFIG="wrangler.jsonc"

# 这两个是随机值，脚本可以自己生成；ADMIN_PASSWORD_HASH 需要你输密码
AUTO_SECRETS=("SESSION_SECRET" "IP_SALT")
PASSWORD_SECRET="ADMIN_PASSWORD_HASH"

CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

# ── 输出 ─────────────────────────────────────────────
step() { printf '\n\033[1;36m▸ %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
info() { printf '    %s\n' "$1"; }
die()  { printf '  \033[31m✗\033[0m %s\n' "$1"; exit 1; }

json_lookup() {
  # $1 = JSON, $2 = JS 表达式，变量名 d 指向解析结果
  printf '%s' "$1" | node -e "
    let s='';
    process.stdin.on('data', c => s += c).on('end', () => {
      try { const d = JSON.parse(s); $2 } catch { console.log(''); }
    });
  "
}

# ── 1. 环境 ──────────────────────────────────────────
step "1/4 环境检查"

command -v node >/dev/null 2>&1 || die "未找到 node"
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
NODE_MINOR=$(node -p "process.versions.node.split('.')[1]")
if [ "$NODE_MAJOR" -lt 20 ] || { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -lt 3 ]; }; then
  die "wrangler 需要 Node >= 20.3，当前 $(node -v)"
fi
ok "Node $(node -v)"

[ -f "$CONFIG" ] || die "找不到 ${CONFIG}，请在项目根目录运行"
[ -d node_modules ] || die "依赖未安装，先运行: npm install"
ok "依赖已安装"

# 不能只看退出码：wrangler 未登录时 whoami 依然返回 0，必须检查输出内容
WHOAMI_OUT=$(npx wrangler whoami 2>&1)
if printf '%s' "$WHOAMI_OUT" | grep -qiE "not authenticated|CLOUDFLARE_API_TOKEN"; then
  die "未登录 Cloudflare，先运行: npx wrangler login"
fi
ok "已登录 Cloudflare"
ACCOUNT=$(printf '%s' "$WHOAMI_OUT" | grep -oE '[0-9a-f]{32}' | head -1)
[ -n "$ACCOUNT" ] && info "Account ID: $ACCOUNT"

# ── 2. 配置 ──────────────────────────────────────────
step "2/4 配置检查"

BUCKET=$(node -e "
  const fs = require('fs');
  const s = fs.readFileSync('$CONFIG','utf8').replace(/^\s*\/\/.*\$/gm,'');
  try { console.log(JSON.parse(s).r2_buckets?.[0]?.bucket_name ?? ''); } catch { console.log(''); }
")
[ -n "$BUCKET" ] || die "${CONFIG} 里没配置 R2 桶"
ok "R2 桶绑定：${BUCKET}"

# 桶在 Cloudflare 那边必须已存在，否则部署会失败
BUCKET_LIST=$(npx wrangler r2 bucket list --json 2>&1) || die "查询 R2 桶列表失败"
if printf '%s' "$BUCKET_LIST" | grep -q "\"$BUCKET\""; then
  ok "桶确实存在"
elif [ "$CHECK_ONLY" -eq 1 ]; then
  warn "桶不存在（需要先在后台或 wrangler r2 bucket create 创建）"
else
  die "R2 桶 ${BUCKET} 不存在，先创建：npx wrangler r2 bucket create ${BUCKET}"
fi

# ── 3. Secrets ───────────────────────────────────────
step "3/4 Secrets"

# secret list 在 Worker 还没创建时会报错，那是首次部署的正常情况，当作"还没有 secret"；
# 但认证类错误必须暴露出来，否则会在错误的结论上继续跑。
SECRET_OUT=$(npx wrangler secret list --json 2>&1)
if printf '%s' "$SECRET_OUT" | grep -qiE "not authenticated|CLOUDFLARE_API_TOKEN"; then
  die "登录状态失效，请重新运行: npx wrangler login"
fi
SECRET_LIST=$(printf '%s' "$SECRET_OUT" | node -e "
  let s='';
  process.stdin.on('data', c => s += c).on('end', () => {
    const i = s.indexOf('[');
    console.log(i < 0 ? '[]' : s.slice(i));
  });
")

has_secret() {
  json_lookup "$SECRET_LIST" "const x=(Array.isArray(d)?d:(d.result||[])).some(v=>v.name==='$1'); console.log(x?'yes':'')"
}

for name in "${AUTO_SECRETS[@]}"; do
  if [ -n "$(has_secret "$name")" ]; then
    ok "$name 已设置"
  elif [ "$CHECK_ONLY" -eq 1 ]; then
    warn "$name 未设置（会自动生成）"
  else
    VALUE=$(node -p "require('crypto').randomBytes(32).toString('base64url')")
    printf '%s' "$VALUE" | npx wrangler secret put "$name" >/dev/null 2>&1 \
      && ok "$name 已生成并设置" || die "设置 $name 失败"
  fi
done

if [ -n "$(has_secret "$PASSWORD_SECRET")" ]; then
  ok "$PASSWORD_SECRET 已设置"
elif [ "$CHECK_ONLY" -eq 1 ]; then
  warn "$PASSWORD_SECRET 未设置（部署时会提示输入密码）"
else
  echo
  info "需要设置管理员密码（用于登录上传）"
  info "账号名固定为 admin，想改的话改 ${CONFIG} 里的 ADMIN_USER"
  printf '    密码: '
  read -r -s ADMIN_PW
  echo
  [ -n "$ADMIN_PW" ] || die "密码不能为空"

  HASH=$(printf '%s' "$ADMIN_PW" | node -e "
    let s='';
    process.stdin.on('data', c => s += c).on('end', () =>
      console.log(require('crypto').createHash('sha256').update(s).digest('hex')));
  ")
  unset ADMIN_PW

  printf '%s' "$HASH" | npx wrangler secret put "$PASSWORD_SECRET" >/dev/null 2>&1 \
    && ok "$PASSWORD_SECRET 已设置" || die "设置失败"
fi

# ── 4. 构建与部署 ────────────────────────────────────
if [ "$CHECK_ONLY" -eq 1 ]; then
  step "4/4 构建与部署"
  info "跳过（--check 模式）"
  printf '\n\033[1;32m检查完成。\033[0m去掉 --check 即执行实际部署。\n\n'
  exit 0
fi

step "4/4 构建与部署"

npm run build >/dev/null 2>&1 || die "构建失败，请单独运行 npm run build 查看错误"
ok "构建完成"

DEPLOY_OUT=$(npx wrangler deploy 2>&1) || { printf '%s\n' "$DEPLOY_OUT"; die "部署失败"; }
ok "部署完成"

WORKER_URL=$(printf '%s' "$DEPLOY_OUT" | grep -oE 'https://[a-zA-Z0-9._-]+\.workers\.dev' | head -1)

printf '\n\033[1;32m部署完成\033[0m\n\n'
if [ -n "$WORKER_URL" ]; then
  printf '  workers.dev 地址: %s\n' "$WORKER_URL"
  printf '  \033[33m注意：workers.dev 在国内网络下不可达，需要绑自定义域名\033[0m\n'
else
  info "在 Cloudflare 后台的 Workers 页面可以看到访问地址"
fi
printf '\n'
