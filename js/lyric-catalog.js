// Folia built-in coverage, verified against 50a3e5239922a32ca0d55cbfa1cdcea9cdfe0278.
// Stable CPlayer ids keep previously saved selections working.
export const LYRIC_EFFECTS = Object.freeze([
  { id: 'plain', name: '普通', group: '基础', renderer: 'text', description: '清晰、安静，让每一句歌词自然呈现。' },
  { id: 'amll', name: 'AMLL', group: '基础', renderer: 'text', description: '柔和虚化与弹性聚焦，沉浸在正在唱的这一句。' },
  { id: 'bounce', name: '跃音', group: '基础', renderer: 'glyph', description: '文字轻盈跃起，和音符一起落下。' },
  { id: 'sonnet', sourceId: 'sonnet', name: '商籁', group: '文字舞台', renderer: 'stage', description: '海报边框、角标与错落字块，展开一幕文字短片。' },
  { id: 'tempera', sourceId: 'tempera', name: '凝彩', group: '文字舞台', renderer: 'stage', description: '冷暖色块交替铺开，短句随构图切入。' },
  { id: 'lumiere', sourceId: 'lumiere', name: '绘光', group: '文字舞台', renderer: 'stage', description: '舞台光束穿过薄雾，照亮中央的歌词。' },
  { id: 'hanabi', sourceId: 'hanabi', name: '花火', group: '文字舞台', renderer: 'stage', description: '明亮字块向上浮现，烟花在字句周围绽开。' },
  { id: 'machi', sourceId: 'machi', name: '町景', group: '文字舞台', renderer: 'stage', description: '雨夜街角的小店，让歌词亮在霓虹招牌上。' },
  { id: 'nebbia', sourceId: 'nebbia', name: '雾笺', group: '文字舞台', renderer: 'stage', description: '雨滴滑过起雾的窗，字句像指尖留下的笔迹。' },
  { id: 'glow', sourceId: 'classic', name: '流光', group: '构图与光影', renderer: 'stage', description: '单句居中，一束温柔的光缓缓掠过文字。' },
  { id: 'cadenza', sourceId: 'cadenza', name: '心象', group: '构图与光影', renderer: 'composition', description: '词句散落成云，焦点词在光圈中浮现。' },
  { id: 'cloud', sourceId: 'partita', name: '云阶', group: '构图与光影', renderer: 'stage', description: '词句沿阶梯逐层铺开，向右下方轻轻舒展。' },
  { id: 'fume', sourceId: 'fume', name: '浮名', group: '构图与光影', renderer: 'stage', description: '大字浮于前景，淡淡的文字残影在背后延伸。' },
  { id: 'tilt', sourceId: 'tilt', name: '倾诉', group: '构图与光影', renderer: 'composition', description: '短句交错铺开，斜体与双色强调心底的声音。' },
  { id: 'monet', sourceId: 'monet', name: '莫奈', group: '构图与光影', renderer: 'stage', description: '歌词与封面左右呼应，关键词浮现柔和的画布色彩。' },
  { id: 'claddagh', sourceId: 'claddagh', name: '回环', group: '空间与对话', renderer: 'stage', description: '歌词停驻椭圆轨道中央，前后的余音环绕其间。' },
  { id: 'pendolo', sourceId: 'pendolo', name: '时计', group: '空间与对话', renderer: 'stage', description: '表盘刻度缓缓转动，歌词沿时光的弧线展开。' },
  { id: 'cappella', sourceId: 'cappella', name: '群唱', group: '空间与对话', renderer: 'text', description: '歌词化作左右交替的对话，像你一句、我一句。' },
  { id: 'diorama', sourceId: 'diorama', name: '镜台', group: '空间与对话', renderer: 'stage', description: '字句与几何镜框分层悬浮，形成有景深的舞台。' },
  { id: 'still', sourceId: 'still', name: '静止', group: '空间与对话', renderer: 'text', description: '三行静态聚焦，关闭歌词过渡与背景动效。' },
].map(effect => Object.freeze(effect)));

export const RANDOM_LYRIC_EFFECT = 'random';
export function resolveLyricEffect(id) {
  if (typeof id !== 'string' || !id) return undefined;
  return LYRIC_EFFECTS.find(effect => effect.id === id || effect.sourceId === id);
}
export function pickLyricEffect(previous, random = Math.random) {
  const pool = LYRIC_EFFECTS.filter(effect => effect.id !== previous);
  const value = Math.max(0, Math.min(.999999, Number(random()) || 0));
  return pool[Math.floor(value * pool.length)].id;
}
