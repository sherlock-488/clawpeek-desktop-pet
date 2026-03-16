function hasNonAscii(text = '') {
  return /[^\x00-\x7F]/.test(String(text || ''));
}

function readableText(value = '') {
  const text = String(value || '').trim();
  if (!text || hasNonAscii(text)) return '';
  if (text.includes('?') && !/[A-Za-z0-9]/.test(text)) return '';
  return text;
}

function phaseLabel(phase = '') {
  switch (String(phase || '')) {
    case 'offline':
      return 'Resting';
    case 'idle':
      return 'Idle';
    case 'queued':
      return 'Queued';
    case 'thinking':
      return 'Processing task';
    case 'tool':
      return 'Using tool';
    case 'waiting':
      return 'Waiting for approval';
    case 'done':
      return 'Completed';
    case 'error':
      return 'Error';
    default:
      return 'Idle';
  }
}

function activityLabel(activity = '') {
  switch (String(activity || '')) {
    case 'list':
      return 'Listing files';
    case 'read':
      return 'Reading file';
    case 'search_code':
      return 'Searching code';
    case 'search_web':
      return 'Searching web';
    case 'browse':
      return 'Browsing page';
    case 'exec':
      return 'Running command';
    case 'write':
      return 'Writing file';
    case 'edit':
      return 'Editing file';
    case 'attach':
      return 'Attaching content';
    case 'tool':
      return 'Using tool';
    default:
      return 'Using tool';
  }
}

export function debugLabelForState(derived = {}) {
  const phase = String(derived?.phase || 'idle');
  if (phase === 'tool') {
    return activityLabel(derived?.activityKind);
  }

  const rawLabel = readableText(derived?.label);
  if (rawLabel && rawLabel !== '[object Object]') {
    return rawLabel;
  }

  return phaseLabel(phase);
}

export function debugLabelForEvent(event = {}) {
  const rawLabel = readableText(event?.label);
  const detail = String(event?.detail || '').trim();

  switch (String(event?.type || '')) {
    case 'SYSTEM_CONNECTING':
      return 'Connecting to OpenClaw';
    case 'SYSTEM_CONNECTED':
      return 'Handshake complete';
    case 'SYSTEM_DISCONNECTED':
      return 'Connection paused';
    case 'SYSTEM_ERROR':
      return rawLabel || 'System error';
    case 'HANDSHAKE_CHALLENGE':
      return 'Received handshake challenge';
    case 'JOB_STATE':
      return rawLabel || 'Job state update';
    case 'TOOL_STARTED':
      return activityLabel(event?.activityKind);
    case 'TOOL_RESULT':
      return `Tool result: ${detail || event?.activityKind || 'tool'}`;
    case 'APPROVAL_REQUESTED':
      return 'Approval required';
    case 'CHAT_FINAL':
      return 'Completed';
    case 'RUN_ERROR':
      return rawLabel || 'Run error';
    case 'RAW_EVENT':
      return `Received ${detail || 'raw'} event`;
    case 'SESSION_IDLE':
      return 'Back to Idle';
    default:
      return rawLabel || String(event?.type || 'event');
  }
}
