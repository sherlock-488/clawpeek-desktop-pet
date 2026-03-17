import { ACTIVITY } from './constants.js';
import { truncate } from './utils.js';

function lower(value) {
  return String(value ?? '').toLowerCase();
}

function firstCommandLine(command) {
  return String(command ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) ?? '';
}

function parseObjectLike(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return '';
}

function commandStartsWith(command, prefixes) {
  const normalized = lower(command);
  return prefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix} `));
}

function classifyExecCommand(command) {
  if (!command) return null;

  if (commandStartsWith(command, ['ls', 'dir', 'tree', 'fd', 'find', 'get-childitem', 'gci'])) {
    return ACTIVITY.LIST;
  }

  if (commandStartsWith(command, ['cat', 'type', 'get-content', 'gc', 'less', 'more', 'head', 'tail'])) {
    return ACTIVITY.READ;
  }

  if (commandStartsWith(command, ['rg', 'grep', 'findstr', 'ag', 'ack', 'ripgrep', 'select-string'])) {
    return ACTIVITY.SEARCH_CODE;
  }

  return ACTIVITY.EXEC;
}

function activityVerb(activityKind) {
  switch (activityKind) {
    case ACTIVITY.LIST:
      return 'Listing files';
    case ACTIVITY.READ:
      return 'Reading file';
    case ACTIVITY.SEARCH_CODE:
      return 'Searching code';
    case ACTIVITY.SEARCH_WEB:
      return 'Searching web';
    case ACTIVITY.BROWSE:
      return 'Browsing page';
    case ACTIVITY.EXEC:
      return 'Running command';
    case ACTIVITY.EDIT:
      return 'Editing file';
    case ACTIVITY.WRITE:
      return 'Writing file';
    case ACTIVITY.ATTACH:
      return 'Attaching content';
    case ACTIVITY.TOOL:
      return 'Using tool';
    default:
      return 'Processing task';
  }
}

function buildLabel(activityKind, subject) {
  const verb = activityVerb(activityKind);
  const trimmedSubject = truncate(subject || '', 64);
  return trimmedSubject ? `${verb}: ${trimmedSubject}` : verb;
}

export function classifyTool(toolName, rawArgs = {}, meta = {}) {
  const args = parseObjectLike(rawArgs);
  const normalizedMeta = parseObjectLike(meta);
  const name = lower(toolName);
  const command = firstCommandLine(
    firstNonEmpty(args.command, args.cmd, normalizedMeta.command, normalizedMeta.rawCommand)
  );
  const path = firstNonEmpty(
    args.path,
    args.filePath,
    args.file_path,
    args.filename,
    args.targetPath,
    normalizedMeta.path,
    normalizedMeta.filePath
  );
  const url = firstNonEmpty(args.url, normalizedMeta.url);
  const query = firstNonEmpty(args.query, args.q, normalizedMeta.query, normalizedMeta.q);
  const execActivity = classifyExecCommand(command);

  const isWebSearch = Boolean(
    name.includes('search_query')
    || name.includes('web_search')
    || name.includes('internet_search')
    || name.includes('brave')
    || name.includes('google')
    || name.includes('duckduckgo')
    || (query && (name.includes('search') || name.includes('query')) && !path && !url && !command)
  );
  if (isWebSearch) {
    return {
      activityKind: ACTIVITY.SEARCH_WEB,
      label: buildLabel(ACTIVITY.SEARCH_WEB, query || toolName),
    };
  }

  const isBrowse = Boolean(
    url
    || name.includes('browser')
    || name.includes('fetch')
    || name.includes('http')
    || name.includes('navigate')
    || name.includes('visit')
  );
  if (isBrowse) {
    return {
      activityKind: ACTIVITY.BROWSE,
      label: buildLabel(ACTIVITY.BROWSE, url || toolName),
    };
  }

  const isList = Boolean(
    name.includes('list')
    || name.includes('glob')
    || name.includes('tree')
    || name.includes('find_path')
    || execActivity === ACTIVITY.LIST
  );
  if (isList) {
    return {
      activityKind: ACTIVITY.LIST,
      label: buildLabel(ACTIVITY.LIST, path || command || toolName),
    };
  }

  const isRead = Boolean(
    name.includes('read')
    || name.includes('open_file')
    || name.includes('cat')
    || normalizedMeta.mode === 'read'
    || execActivity === ACTIVITY.READ
  );
  if (isRead) {
    return {
      activityKind: ACTIVITY.READ,
      label: buildLabel(ACTIVITY.READ, path || command || toolName),
    };
  }

  const isCodeSearch = Boolean(
    name.includes('search_code')
    || name.includes('grep')
    || name.includes('findstr')
    || name.includes('ripgrep')
    || name.includes('rg')
    || execActivity === ACTIVITY.SEARCH_CODE
  );
  if (isCodeSearch) {
    return {
      activityKind: ACTIVITY.SEARCH_CODE,
      label: buildLabel(ACTIVITY.SEARCH_CODE, query || path || command || toolName),
    };
  }

  if (name.includes('write') || name.includes('save') || normalizedMeta.mode === 'write') {
    return {
      activityKind: ACTIVITY.WRITE,
      label: buildLabel(ACTIVITY.WRITE, path || toolName),
    };
  }

  if (name.includes('edit') || name.includes('patch') || name.includes('apply')) {
    return {
      activityKind: ACTIVITY.EDIT,
      label: buildLabel(ACTIVITY.EDIT, path || toolName),
    };
  }

  if (name.includes('attach') || name.includes('upload') || name.includes('camera') || name.includes('canvas')) {
    return {
      activityKind: ACTIVITY.ATTACH,
      label: buildLabel(ACTIVITY.ATTACH, path || url || toolName),
    };
  }

  if (name.includes('system.run') || name.includes('exec') || command) {
    return {
      activityKind: ACTIVITY.EXEC,
      label: buildLabel(ACTIVITY.EXEC, command || toolName),
    };
  }

  return {
    activityKind: ACTIVITY.TOOL,
    label: buildLabel(ACTIVITY.TOOL, toolName || 'tool'),
  };
}

export function glyphForActivity(activityKind) {
  switch (activityKind) {
    case ACTIVITY.LIST:
      return '🗂️';
    case ACTIVITY.READ:
      return '📖';
    case ACTIVITY.SEARCH_CODE:
      return '🔎';
    case ACTIVITY.SEARCH_WEB:
      return '🌐';
    case ACTIVITY.BROWSE:
      return '🧭';
    case ACTIVITY.EXEC:
      return '⚙️';
    case ACTIVITY.WRITE:
      return '✍️';
    case ACTIVITY.EDIT:
      return '📝';
    case ACTIVITY.ATTACH:
      return '📎';
    case ACTIVITY.TOOL:
      return '🛠️';
    default:
      return '🦞';
  }
}
