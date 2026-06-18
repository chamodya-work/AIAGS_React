export function envFlag(name, defaultValue = true) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

export function envNumber(name, defaultValue) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : defaultValue;
}

export function cleanText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

export function extractEmails(value) {
  const text = cleanText(value);
  if (!text) return [];
  return [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)]
    .map((match) => match[0].toLowerCase());
}

export function allowedDomains() {
  return String(process.env.UNIVERSITY_ALLOWED_EMAIL_DOMAINS || 'kln.ac.lk,stu.kln.ac.lk')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function pickPreferredEmail(value, { fallbackNetId = '', fallbackDomain = 'kln.ac.lk' } = {}) {
  const emails = extractEmails(value);
  const domains = allowedDomains();
  const preferred = emails.find((email) => domains.some((domain) => email.endsWith(`@${domain}`)));
  if (preferred) return preferred;
  if (emails[0]) return emails[0];
  const netId = cleanText(fallbackNetId).toLowerCase();
  return netId ? `${netId}@${fallbackDomain}` : '';
}

export function safeRawProfile(raw) {
  const clone = JSON.parse(JSON.stringify(raw || {}));
  delete clone.password;
  delete clone.permenentAddress;
  delete clone.permanentAddress;
  delete clone.contactHome;
  delete clone.contactMobile;
  delete clone.mobile;
  return clone;
}

export function parseJsonishResponse(data) {
  if (data && typeof data === 'object') return data;
  const text = cleanText(data);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    }
    const phpArray = parsePhpPrintArray(text);
    if (phpArray) return phpArray;
    throw new Error('Invalid university API response');
  }
}

function parseScalar(value) {
  const text = cleanText(value);
  if (text === '') return '';
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text.replace(/^["']|["']$/g, '');
}

function parsePhpPrintArray(text) {
  const source = cleanText(text);
  if (!source.startsWith('Array')) return null;
  let index = 0;

  function skipSpace() {
    while (/\s/.test(source[index] || '')) index += 1;
  }

  function consume(value) {
    skipSpace();
    if (source.slice(index, index + value.length) !== value) return false;
    index += value.length;
    return true;
  }

  function parseArray() {
    if (!consume('Array')) return null;
    skipSpace();
    if (!consume('(')) return null;
    const out = {};

    while (index < source.length) {
      skipSpace();
      if (source[index] === ')') {
        index += 1;
        return out;
      }

      if (source[index] !== '[') return null;
      const keyEnd = source.indexOf(']', index + 1);
      if (keyEnd < 0) return null;
      const key = source.slice(index + 1, keyEnd);
      index = keyEnd + 1;
      skipSpace();
      if (!consume('=>')) return null;
      skipSpace();

      if (source.slice(index, index + 5) === 'Array') {
        out[key] = parseArray();
      } else {
        const nextKey = source.slice(index).search(/\s+\[[^\]]+\]\s*=>/);
        const closeParen = source.indexOf(')', index);
        let valueEnd;
        if (nextKey >= 0 && (closeParen < 0 || index + nextKey < closeParen)) {
          valueEnd = index + nextKey;
        } else {
          valueEnd = closeParen >= 0 ? closeParen : source.length;
        }
        out[key] = parseScalar(source.slice(index, valueEnd));
        index = valueEnd;
      }
    }

    return out;
  }

  return parseArray();
}
