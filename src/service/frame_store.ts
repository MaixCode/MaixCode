import { FrameSink } from "../ports/frame_sink";

export interface FrameMetadata {
  width?: number;
  height?: number;
  colorSpace?: string;
  format?: string;
}

export interface Frame {
  key: string;
  buffer: ArrayBuffer;
  mime: string;
  timestamp: number;
  metadata?: FrameMetadata;
}

export type FrameListener = (frame: Frame) => void;

/**
 * Latest-frame store per device key. Implements FrameSink for device wiring.
 * Transports (HTTP / WS / MJPEG) and UI subscribe; they do not own frame data.
 */
export class FrameStore implements FrameSink {
  private readonly frames = new Map<string, Frame>();
  private readonly keyListeners = new Map<string, Set<FrameListener>>();
  private readonly anyListeners = new Set<FrameListener>();

  public setImage(
    key: string,
    imageData: ArrayBuffer,
    metadata?: FrameMetadata
  ): void {
    if (!key) {
      return;
    }
    const prev = this.frames.get(key);
    if (
      prev &&
      prev.buffer === imageData &&
      prev.metadata?.width === metadata?.width &&
      prev.metadata?.height === metadata?.height
    ) {
      return;
    }

    const format = metadata?.format?.toLowerCase();
    const mime =
      format === "png" || format === "image/png"
        ? "image/png"
        : "image/jpeg";

    const frame: Frame = {
      key,
      buffer: imageData,
      mime,
      timestamp: Date.now(),
      metadata: metadata
        ? {
            ...metadata,
            format: metadata.format ?? (mime === "image/png" ? "PNG" : "JPEG"),
          }
        : { format: mime === "image/png" ? "PNG" : "JPEG" },
    };

    this.frames.set(key, frame);
    this.emit(frame);
  }

  public getFrame(key: string): Frame | undefined {
    return this.frames.get(key);
  }

  public has(key: string): boolean {
    return this.frames.has(key);
  }

  public keys(): string[] {
    return Array.from(this.frames.keys());
  }

  public clearKey(key: string): void {
    this.frames.delete(key);
  }

  public clear(): void {
    this.frames.clear();
  }

  /** Subscribe to updates for one key. Returns unsubscribe. */
  public subscribe(key: string, listener: FrameListener): () => void {
    let set = this.keyListeners.get(key);
    if (!set) {
      set = new Set();
      this.keyListeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) {
        this.keyListeners.delete(key);
      }
    };
  }

  /** Subscribe to all key updates. Returns unsubscribe. */
  public subscribeAll(listener: FrameListener): () => void {
    this.anyListeners.add(listener);
    return () => {
      this.anyListeners.delete(listener);
    };
  }

  private emit(frame: Frame): void {
    const set = this.keyListeners.get(frame.key);
    if (set) {
      for (const listener of set) {
        try {
          listener(frame);
        } catch {
          // ignore listener errors
        }
      }
    }
    for (const listener of this.anyListeners) {
      try {
        listener(frame);
      } catch {
        // ignore
      }
    }
  }
}
