import { truncate } from '../core/utils.js';

const ACTIVITY_ICON = Object.freeze({
  none: '🦞',
  list: '🗂️',
  read: '📖',
  search_code: '🔎',
  search_web: '🌐',
  browse: '🧭',
  exec: '⚙️',
  write: '✍️',
  edit: '📝',
  attach: '📎',
  tool: '🛠️',
  other: '🦞',
});

function normalizePhase(phase = '') {
  return phase === 'tool' ? 'thinking' : String(phase || 'idle');
}

function fallbackDetail(phase) {
  switch (phase) {
    case 'offline':
      return '没有检测到可用的 Gateway，龙虾先休息。';
    case 'idle':
      return '已经连上 Gateway，当前没有活跃任务。';
    case 'queued':
      return '任务刚进入队列，马上开始。';
    case 'thinking':
      return '正在处理 OpenClaw 当前的工作流。';
    case 'waiting':
      return '正在等你授权或补充输入。';
    case 'done':
      return '刚刚完成了一步。';
    case 'error':
      return '刚才那一步出了问题。';
    default:
      return '状态可用，但还没有进一步说明。';
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
      return '处理中';
    case 'waiting':
      return '等待中';
    case 'done':
      return '完成';
    case 'error':
      return '出错';
    default:
      return '状态中';
  }
}

function headlineForPhase(phase) {
  switch (phase) {
    case 'offline':
      return '龙虾休息中';
    case 'idle':
      return '龙虾空闲中';
    case 'queued':
      return '龙虾准备开工';
    case 'thinking':
      return '龙虾正在处理工作流';
    case 'waiting':
      return '龙虾举钳等待';
    case 'done':
      return '龙虾刚完成一步';
    case 'error':
      return '龙虾这步出错了';
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
  return ['queued', 'thinking', 'waiting', 'done', 'error'].includes(phase);
}

export function derivePetViewModel(state = {}) {
  const derived = state?.derived || {};
  const phase = normalizePhase(derived.phase);
  const activity = String(derived.activityKind || 'none');
  const detail = truncate(derived.label || fallbackDetail(phase), 88);

  return {
    phase,
    activity,
    chipText: chipForPhase(phase),
    headline: headlineForPhase(phase),
    detail,
    overlayIcon: phase === 'idle' ? ACTIVITY_ICON.none : (ACTIVITY_ICON[activity] || ACTIVITY_ICON.tool),
    overlayText: chipForPhase(phase),
    connectionText: connectionText(state?.connection),
    showOverlay: shouldShowOverlay(phase),
    title: `${headlineForPhase(phase)} · ${detail}`,
  };
}
