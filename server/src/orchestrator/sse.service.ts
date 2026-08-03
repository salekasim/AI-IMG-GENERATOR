import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export interface SseEvent {
  type: string;
  ts: string;
  [key: string]: unknown;
}

@Injectable()
export class SseService {
  private readonly emitters = new Map<string, EventEmitter>();
  private readonly done = new Set<string>();

  private emitter(id: string): EventEmitter {
    let emitter = this.emitters.get(id);
    if (!emitter) {
      emitter = new EventEmitter();
      this.emitters.set(id, emitter);
    }
    return emitter;
  }

  publish(id: string, event: Omit<SseEvent, 'ts'>): void {
    const emitter = this.emitters.get(id);
    if (!emitter) return;
    emitter.emit('event', { ...event, ts: new Date().toISOString() });
  }

  on(id: string, handler: (event: SseEvent) => void): void {
    this.emitter(id).on('event', handler);
  }

  off(id: string, handler: (event: SseEvent) => void): void {
    this.emitters.get(id)?.off('event', handler);
  }

  isDone(id: string): boolean {
    return this.done.has(id);
  }

  onDone(id: string, handler: () => void): void {
    this.emitter(id).once('done', handler);
  }

  end(id: string): void {
    const emitter = this.emitter(id);
    this.done.add(id);
    emitter.emit('done');
    setTimeout(() => {
      emitter.removeAllListeners();
      this.emitters.delete(id);
      this.done.delete(id);
    }, 60_000);
  }
}
