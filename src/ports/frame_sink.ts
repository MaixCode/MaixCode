/**
 * Sink for device camera/preview frames.
 * Implemented by ImageService; consumed by DeviceService wiring (via composition root).
 */
export interface FrameSink {
  setImage(
    key: string,
    imageData: ArrayBuffer,
    metadata?: {
      width?: number;
      height?: number;
      colorSpace?: string;
      format?: string;
    }
  ): void;
}
