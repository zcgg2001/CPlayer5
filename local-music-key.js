export const MUSIC_KEY_PATH = '/api/v1/settings/music-key';
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function failure(status, message) {
  return json({ error: { code: 'music_key_settings', message } }, status);
}

function trustedLocalRequest(incoming, url) {
  const fetchSite = incoming.headers['sec-fetch-site'];
  return LOOPBACK_ADDRESSES.has(incoming.socket.remoteAddress)
    && LOOPBACK_ADDRESSES.has(incoming.socket.localAddress)
    && LOOPBACK_HOSTS.has(url.hostname)
    && url.port === String(incoming.socket.localPort)
    && (!incoming.headers.origin || incoming.headers.origin === url.origin)
    && (!fetchSite || ['same-origin', 'none'].includes(fetchSite));
}

// Local configuration is deliberately not included in the public worker build.
export function createMusicKeySettings(env) {
  let source = env.CHKSZ_API_KEY ? 'environment' : 'none';
  const guard = (incoming, url) => {
    if (!trustedLocalRequest(incoming, url)) {
      incoming.resume();
      return failure(403, '仅允许本机播放器页面配置和使用个人密钥');
    }
    return null;
  };
  const handle = async (incoming, url) => {
    const blocked = guard(incoming, url);
    if (blocked) return blocked;
    const origin = incoming.headers.origin;
    const status = () => json({ configured: Boolean(env.CHKSZ_API_KEY), editable: true, source });
    if (incoming.method === 'GET') return status();
    if (!['POST', 'DELETE'].includes(incoming.method)) {
      incoming.resume();
      return failure(405, '不支持的配置操作');
    }
    if (origin !== url.origin || incoming.headers['x-cplayer-settings'] !== '1') {
      incoming.resume();
      return failure(403, '请在播放器设置中提交密钥');
    }
    if (incoming.method === 'DELETE') {
      incoming.resume();
      env.CHKSZ_API_KEY = '';
      source = 'none';
      return status();
    }
    if (incoming.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
      incoming.resume();
      return failure(415, '请使用 JSON 提交密钥');
    }
    try {
      const body = await new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        incoming.on('data', chunk => {
          size += chunk.length;
          if (size > 2048) { reject(new Error('too_large')); return; }
          chunks.push(chunk);
        });
        incoming.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        incoming.on('error', reject);
        incoming.on('aborted', () => reject(new Error('aborted')));
      });
      const input = JSON.parse(body);
      const key = typeof input?.key === 'string' ? input.key.trim() : '';
      if (!/^chksz_[A-Za-z0-9_-]+$/.test(key) || key.length > 512) {
        return failure(400, '请输入以 chksz_ 开头的完整个人 API Key');
      }
      env.CHKSZ_API_KEY = key;
      source = 'session';
      return status();
    } catch (error) {
      return failure(error.message === 'too_large' ? 413 : 400, '密钥格式无效，请重新填写');
    }
  };
  return { handle, guard: (incoming, url) => source === 'session' ? guard(incoming, url) : null };
}
