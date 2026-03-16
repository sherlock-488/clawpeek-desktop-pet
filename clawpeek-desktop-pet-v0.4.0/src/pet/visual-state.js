import { truncate } from '../core/utils.js';

const ACTIVITY_ICON = Object.freeze({
  none: '🦞',
  list: '🗂️',
  read: '📄',
  search_code: '🔎',
  search_web: '🌍',
  browse: '🌐',
  exec: '⌨️',
  write: '✍️',
  edit: '📝',
  attach: '📎',
  tool: '🛠️',
  other: '🦞',
});

const ACTIVITY_SHORT = Object.freeze({
  none: '巡航',
  list: '看目录',
  read: '读文件',
  search_code: '搜代码',
  search_web: '搜网页',
  browse: '看网页',
  exec: '跑命令',
  write: '写内容',
  edit: '改文件',
  attach: '挂附件',
  tool: '跑工具',
  other: '处理中',
});

function fallbackDetail(phase, activity) {
  switch (phase) {
    case 'offline':
      return '没有检测到可用的 Gateway，龙虾先休息。';
    case 'idle':
      return '已经连上 Gateway，当前没有活跃任务。';
    case 'queued':
      return '任务刚被接住，马上开工。';
    case 'thinking':
      return '正在分析上下文与输出。';
    case 'tool':
      return `正在${ACTIVITY_SHORT[activity] || '调用工具'}。`;
    case 'waiting':
      return '等你授权或者补输入。';
    case 'done':
      return '刚刚完成了一步。';
    case 'error':
      return '刚才那一步出了岔子。';
    default:
      return '状态可用，但还没归类。';
  }
}

function chipForPhase(phase) {
  switch (phase) {
    case 'offline':
      return '休息中';
    case 'idle':
      return '空闲中';
    case 'queued':
      return '排队中';
    case 'thinking':
      return '思考中';
    case 'tool':
      return '工具中';
    case 'waiting':
      return '等待中';
    case 'done':
      return '完成';
    case 'error':
      return '出错';
    default:
      return '状态';
  }
}

function headlineForPhase(phase, activity) {
  switch (phase) {
    case 'offline':
      return '龙虾休息中';
    case 'idle':
      return '龙虾空闲中';
    case 'queued':
      return '龙虾抬头看任务';
    case 'thinking':
      return '龙虾正在思考';
    case 'tool':
      return `龙虾正在${ACTIVITY_SHORT[activity] || '跑工具'}`;
    case 'waiting':
      return '龙虾举钳等待';
    case 'done':
      return '龙虾庆祝一下';
    case 'error':
      return '龙虾有点暴躁';
    default:
      return '龙虾观察中';
  }
}

function connectionText(connection) {
  switch (connection) {
    case 'connected':
      return '已连接';
    case 'connecting':
      return '连接中';
    case 'error':
      return '连接失败';
    default:
      return '休息中';
  }
}

function shouldShowOverlay(phase) {
  return ['queued', 'thinking', 'tool', 'waiting', 'done', 'error'].includes(phase);
}

export function derivePetViewModel(state = {}) {
  const derived = state?.derived || {};
  const phase = String(derived.phase || 'idle');
  const activity = String(derived.activityKind || 'none');
  const detail = truncate(derived.label || fallbackDetail(phase, activity), 88);
  const overlayIcon = phase === 'idle' ? ACTIVITY_ICON.none : ACTIVITY_ICON[activity] || ACTIVITY_ICON.tool;
  const overlayText = phase === 'tool' ? (ACTIVITY_SHORT[activity] || '工具') : chipForPhase(phase);

  return {
    phase,
    activity,
    chipText: chipForPhase(phase),
    headline: headlineForPhase(phase, activity),
    detail,
    overlayIcon,
    overlayText,
    connectionText: connectionText(state?.connection),
    showOverlay: shouldShowOverlay(phase),
    title: `${headlineForPhase(phase, activity)} · ${detail}`,
  };
}
