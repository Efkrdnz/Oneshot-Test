// Snapshot-based undo / redo.

export class History {
  constructor(limit = 80) {
    this.limit = limit;
    this.stack = [];
    this.index = -1;
  }

  reset(snapshot) {
    this.stack = [{ json: snapshot, label: 'start' }];
    this.index = 0;
  }

  push(snapshot, label = '') {
    if (this.index >= 0 && this.stack[this.index].json === snapshot) return false;
    this.stack.length = this.index + 1;
    this.stack.push({ json: snapshot, label });
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
    return true;
  }

  get canUndo() {
    return this.index > 0;
  }

  get canRedo() {
    return this.index < this.stack.length - 1;
  }

  undo() {
    if (!this.canUndo) return null;
    this.index--;
    return this.stack[this.index];
  }

  redo() {
    if (!this.canRedo) return null;
    this.index++;
    return this.stack[this.index];
  }
}
