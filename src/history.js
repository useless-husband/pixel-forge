// 復原/重做。每一步是 {label, undo(), redo()}。
// 像素修改只存「被改到的索引 + 改前/改後的值」（diff），不存整張圖。

export class History {
  constructor(limit = 500) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  push(entry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  undo() {
    const e = this.undoStack.pop();
    if (!e) return null;
    e.undo();
    this.redoStack.push(e);
    return e;
  }
  redo() {
    const e = this.redoStack.pop();
    if (!e) return null;
    e.redo();
    this.undoStack.push(e);
    return e;
  }
  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

/** 一個 cel 上的像素差異。idx 用 Uint16Array（256×256 = 65536，索引最大 65535）。 */
export function pixelEntry(cel, idx, before, after, label = '繪製') {
  return {
    label,
    bytes: idx.length * 6,
    undo() { for (let i = 0; i < idx.length; i++) cel[idx[i]] = before[i]; },
    redo() { for (let i = 0; i < idx.length; i++) cel[idx[i]] = after[i]; },
  };
}

export function groupEntry(entries, label) {
  return {
    label,
    bytes: entries.reduce((s, e) => s + (e.bytes || 0), 0),
    undo() { for (let i = entries.length - 1; i >= 0; i--) entries[i].undo(); },
    redo() { for (const e of entries) e.redo(); },
  };
}
