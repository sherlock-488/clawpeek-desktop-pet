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

function debugLabelForState(derived = {}) {
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

module.exports = {
  debugLabelForState,
};
