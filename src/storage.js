// localStorage 自動存檔（有大小檢查）。storage 參數可注入，方便測試。
import { serializeDoc, parseProject } from './project.js';

// localStorage 上限通常約 5M 個字元；保守抓 3M，並留給其他資料空間。
export const MAX_AUTOSAVE_CHARS = 3_000_000;

export function saveToStorage(storage, key, doc, maxChars = MAX_AUTOSAVE_CHARS) {
  let text;
  try { text = serializeDoc(doc); } catch (e) { return { ok: false, reason: 'serialize', error: e }; }
  if (text.length > maxChars) return { ok: false, reason: 'too-large', size: text.length };
  try {
    storage.setItem(key, text);
    return { ok: true, size: text.length };
  } catch (e) {
    return { ok: false, reason: 'quota', size: text.length, error: e };
  }
}

export function loadFromStorage(storage, key) {
  try {
    const text = storage.getItem(key);
    if (!text) return null;
    return parseProject(text);
  } catch {
    return null;
  }
}
