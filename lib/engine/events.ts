export class EventCollector {
  private buf: string[] = [];

  push(evt: string) {
    this.buf.push(evt);
  }

  snapshot(): string[] {
    return [...this.buf];
  }

  flush(): string[] {
    const out = this.buf;
    this.buf = [];
    return out;
  }

  clear() {
    this.buf = [];
  }
}

