import { LYRIC_EFFECTS, resolveLyricEffect } from '../lyric-catalog.js';

const range = (key, label, min, max, value, step = 0.1) => ({ key, label, min, max, value, step });
const options = {
  plain: [], amll: [range('blur', '远处歌词虚化', 0, 5, 1.2)], bounce: [range('lift', '跃起幅度', 0, 30, 10, 1)],
  glow: [range('rotation', '逐字旋转', 0, 20, 6, 1), range('float', '呼吸幅度', 0, 20, 4, 1)],
  cadenza: [range('spread', '词语错落', 0, 1, .6), range('emphasis', '焦点词放大', 1, 1.5, 1.12, .02)],
  cloud: [range('step', '阶梯错位', 0, 36, 16, 1), range('guides', '引导线透明度', 0, 1, .3)],
  tilt: [range('angle', '倾斜角度', -14, 14, -6, 1), range('emphasis', '强调比例', 0, 1, .4)],
  still: [], sonnet: [range('tracking', '字符间距', 0, 10, 2, 1), range('frame', '边框透明度', 0, 1, .4)],
  tempera: [range('blocks', '色块强度', 0, 1, .4), range('split', '上下构图比例', .25, .75, .5, .05)],
  cappella: [range('bubble', '气泡透明度', .05, .5, .15, .05), range('avatars', '显示角色标记', 0, 1, 1, 1)],
  monet: [range('portrait', '封面占比', .2, .55, .35, .05), range('saturation', '封面饱和度', 0, 2, .8)],
  claddagh: [range('radius', '轨道半径', .2, .42, .32, .02), range('incline', '轨道倾角', -35, 35, -12, 1)],
  pendolo: [range('speed', '表盘转速', .1, 2, .6), range('radius', '表盘大小', .2, .7, .45, .05)],
  lumiere: [range('beam', '光束强度', 0, 1, .4), range('swing', '光束摆幅', 0, 30, 12, 1)],
  hanabi: [range('burst', '烟花大小', .2, 1, .6), range('density', '烟花密度', 1, 5, 3, 1)],
  fume: [range('speed', '镜头速度', .1, 2, .5), range('depth', '空间景深', .2, 1, .6)],
  diorama: [range('speed', '镜头速度', .1, 2, .5), range('particles', '点云密度', 60, 480, 240, 20)],
  machi: [range('rain', '雨幕密度', 0, 1, .5), range('neon', '霓虹亮度', .1, 1, .5)],
  nebbia: [range('fog', '雾气浓度', 0, .9, .4), range('rain', '雨滴密度', 0, 1, .5)],
};

export const BACKGROUNDS = [
  ['common', '通用光晕'], ['latent', '隐现 · 像素流体'], ['monet', '莫奈 · 封面'],
  ['nomand', '漫游 · 纸感'], ['sora', '空 · 星空'], ['url', '嵌入网页'],
];
export const RENDERERS = LYRIC_EFFECTS.map(effect => ({
  ...effect, view: ['plain', 'amll', 'bounce'].includes(effect.id) ? 'list' : 'stage',
  parameters: options[effect.id],
  defaults: Object.fromEntries(options[effect.id].map(option => [option.key, option.value])),
}));
export const rendererFor = id => RENDERERS.find(mode => mode.id === resolveLyricEffect(id)?.id) || RENDERERS[1];
export function normalizeTuning(id, value) {
  return Object.fromEntries(rendererFor(id).parameters.map(option => [option.key, typeof value?.[option.key] === 'number' && Number.isFinite(value[option.key]) ? Math.min(option.max, Math.max(option.min, value[option.key])) : option.value]));
}
