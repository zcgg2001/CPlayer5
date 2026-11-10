import { betterAuth } from 'better-auth';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { phoneNumber } from 'better-auth/plugins/phone-number';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { deviceAuthorization } from 'better-auth/plugins/device-authorization';
import { bearer } from 'better-auth/plugins/bearer';
import { username } from 'better-auth/plugins/username';

export function accountCapabilities(env) {
  let origin;
  try { const url = new URL(env.AUTH_URL); if (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) origin = url.origin; } catch {}
  const enabled = Boolean(origin && env.ACCOUNTS_DB && String(env.AUTH_SECRET || '').length >= 32);
  return { enabled, username: enabled, origin, email: enabled && Boolean(env.ACCOUNT_DELIVER_EMAIL || (env.RESEND_API_KEY && env.AUTH_EMAIL_FROM)), phone: enabled && Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID), github: enabled && Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET), google: enabled && Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), wechat: enabled && Boolean(env.WECHAT_APP_ID && env.WECHAT_APP_SECRET), development: Boolean(env.ACCOUNT_DELIVER_EMAIL) };
}
async function providerJSON(env, url, options = {}) {
  const response = await (env.ACCOUNT_FETCH || fetch)(url, { ...options, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('登录服务暂时无法发送或验证，请稍后重试');
  return response.json();
}
export function wechatProvider(env) {
  return {
    providerId: 'wechat', clientId: env.WECHAT_APP_ID, clientSecret: env.WECHAT_APP_SECRET,
    authorizationUrl: 'https://open.weixin.qq.com/connect/qrconnect#wechat_redirect',
    tokenUrl: 'https://api.weixin.qq.com/sns/oauth2/access_token', scopes: ['snsapi_login'], pkce: false,
    authorizationUrlParams: { appid: env.WECHAT_APP_ID },
    async getToken({ code }) {
      const query = new URLSearchParams({ appid: env.WECHAT_APP_ID, secret: env.WECHAT_APP_SECRET, code, grant_type: 'authorization_code' });
      const data = await providerJSON(env, `https://api.weixin.qq.com/sns/oauth2/access_token?${query}`);
      if (data.errcode || !data.openid || !data.access_token) throw new Error('微信授权失败');
      return { accessToken: data.access_token, refreshToken: data.refresh_token, accessTokenExpiresAt: new Date(Date.now() + Number(data.expires_in || 7200) * 1000), raw: { openid: data.openid } };
    },
    async getUserInfo(tokens) {
      const query = new URLSearchParams({ access_token: tokens.accessToken, openid: tokens.raw.openid, lang: 'zh_CN' });
      const data = await providerJSON(env, `https://api.weixin.qq.com/sns/userinfo?${query}`);
      if (data.errcode || data.openid !== tokens.raw.openid) throw new Error('微信身份验证失败');
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.WECHAT_APP_ID}:${data.openid}`)))].map(n => n.toString(16).padStart(2, '0')).join('');
      return { id: data.openid, name: data.nickname || '微信用户', email: `wechat-${hash}@users.invalid`, emailVerified: false, image: /^https:\/\//.test(data.headimgurl || '') ? data.headimgurl : undefined };
    },
  };
}
export function authOptions(env) {
  const caps = accountCapabilities(env);
  const twilio = (operation, values) => providerJSON(env, `https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/${operation}`, { method: 'POST', headers: { authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values) });
  const plugins = [bearer(), deviceAuthorization({ verificationUri: `${caps.origin}/?device=1`, validateClient: id => id === 'cplayer-desktop', expiresIn: '10m', interval: '5s' }), emailOTP({
    otpLength: 6, expiresIn: 300, allowedAttempts: 5, storeOTP: 'hashed', rateLimit: { window: 60, max: 3 },
    async sendVerificationOTP({ email, otp, type }) {
      if (!caps.email || type !== 'sign-in') throw new Error('邮箱登录尚未开通');
      if (email.endsWith('.invalid')) throw new Error('请输入可收件的邮箱');
      if (env.ACCOUNT_DELIVER_EMAIL) return env.ACCOUNT_DELIVER_EMAIL({ email, otp });
      await providerJSON(env, 'https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: env.AUTH_EMAIL_FROM, to: [email], subject: 'CPlayer5 登录验证码', text: `你的登录验证码是 ${otp}，5 分钟内有效。请勿向他人提供验证码。` }) });
    },
  }), phoneNumber({
    phoneNumberValidator: phone => /^\+[1-9]\d{7,14}$/.test(phone), expiresIn: 300, allowedAttempts: 5,
    sendOTP: async ({ phoneNumber }) => { if (!caps.phone) throw new Error('手机登录尚未开通'); await twilio('Verifications', { To: phoneNumber, Channel: 'sms' }); },
    verifyOTP: async ({ phoneNumber, code }) => caps.phone && (await twilio('VerificationCheck', { To: phoneNumber, Code: code })).status === 'approved',
    signUpOnVerification: { getTempEmail: phone => `phone-${phone.slice(1)}@users.invalid`, getTempName: phone => `手机用户 ${phone.slice(-4)}` },
  })];
  plugins.push(username({ displayUsername: false, minUsernameLength: 3, maxUsernameLength: 24, usernameValidator: value => /^[a-zA-Z0-9_]{3,24}$/.test(value), immutableUsername: true }));
  if (caps.wechat) plugins.push(genericOAuth({ config: [wechatProvider(env)] }));
  return {
    appName: 'CPlayer5', baseURL: caps.origin, basePath: '/api/auth', secret: env.AUTH_SECRET, database: env.ACCOUNTS_DB,
    trustedOrigins: [caps.origin], plugins, logger: { disabled: true },
    emailAndPassword: { enabled: true, requireEmailVerification: false, minPasswordLength: 8, maxPasswordLength: 128 },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 86400, freshAge: 300, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 60, customRules: { '/sign-in/username': { window: 60, max: 10 }, '/sign-up/email': { window: 60, max: 5 } } },
    advanced: { database: { generateId: () => crypto.randomUUID() }, ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    account: { accountLinking: { enabled: false }, encryptOAuthTokens: true },
    user: { deleteUser: { enabled: true } },
    socialProviders: { ...(caps.github ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } } : {}), ...(caps.google ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } } : {}) },
  };
}
// Per-request auth instances avoid retaining request-owned D1 handles in Workers.
export const createAccountAuth = env => betterAuth(authOptions(env));
