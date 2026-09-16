/**
 * Runtime polyfills for the JavaScript features pdf.js 6 relies on but the
 * Chromium in older VS Code builds (engines ^1.128 — Electron 38/Chromium
 * 138) does not ship yet: `Map#getOrInsertComputed` (16 uses), the
 * `Uint8Array` base64 helpers, `Math.sumPrecise` (14 uses in the worker),
 * and `Promise.try`. The same implementation runs on the main thread and is
 * injected verbatim into the pdf.js worker blob (the worker runs in the same
 * old Chromium).
 */
function installPdfPolyfills(scope: {
  Map: MapConstructor;
  Promise: PromiseConstructor;
  Math: Math;
  Uint8Array: Uint8ArrayConstructor;
}): void {
  const MapCtor = scope.Map as MapConstructor & { prototype: Record<string, unknown> };
  if (MapCtor && typeof MapCtor.prototype.getOrInsertComputed !== 'function') {
    Object.defineProperty(MapCtor.prototype, 'getOrInsertComputed', {
      value: function getOrInsertComputed(this: Map<unknown, unknown>, key: unknown, callback: (key: unknown) => unknown) {
        if (this.has(key)) {
          return this.get(key);
        }
        const value = callback(key);
        this.set(key, value);
        return value;
      },
      writable: true,
      configurable: true,
    });
  }

  const PromiseCtor = scope.Promise as PromiseConstructor & { try?: unknown };
  if (PromiseCtor && typeof PromiseCtor.try !== 'function') {
    Object.defineProperty(PromiseCtor, 'try', {
      value: function tryFn(callback: (...args: unknown[]) => unknown, ...args: unknown[]) {
        return new Promise((resolve) => resolve(callback(...args)));
      },
      writable: true,
      configurable: true,
    });
  }

  const U8 = scope.Uint8Array as Uint8ArrayConstructor & {
    prototype: Record<string, unknown>;
    fromBase64?: (text: string) => Uint8Array;
  };
  if (U8 && typeof U8.prototype.toBase64 !== 'function') {
    Object.defineProperty(U8.prototype, 'toBase64', {
      value: function toBase64(this: Uint8Array) {
        let binary = '';
        for (let i = 0; i < this.length; i += 0x8000) {
          binary += String.fromCharCode.apply(
            null,
            this.subarray(i, i + 0x8000) as unknown as number[]
          );
        }
        return btoa(binary);
      },
      writable: true,
      configurable: true,
    });
  }
  if (U8 && typeof U8.fromBase64 !== 'function') {
    Object.defineProperty(U8, 'fromBase64', {
      value: function fromBase64(text: string) {
        const binary = atob(text);
        const bytes = new U8(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
      },
      writable: true,
      configurable: true,
    });
  }

  // The spec returns the exact sum; all pdf.js call sites sum integer sizes
  // and lengths, where this Neumaier-compensated sum is exact as well.
  const MathObj = scope.Math as Math & { sumPrecise?: (values: Iterable<number>) => number };
  if (MathObj && typeof MathObj.sumPrecise !== 'function') {
    MathObj.sumPrecise = function sumPrecise(values: Iterable<number>): number {
      let sum = 0;
      let compensation = 0;
      for (const value of values) {
        const next = sum + value;
        compensation += Math.abs(sum) >= Math.abs(value) ? sum - next + value : value - next + sum;
        sum = next;
      }
      return sum + compensation;
    };
  }
}

export function applyPdfPolyfills(): void {
  installPdfPolyfills(globalThis as unknown as Parameters<typeof installPdfPolyfills>[0]);
}

/** The same implementation, embedded into the worker blob (no imports). */
export const PDF_WORKER_POLYFILL_SOURCE = `(${installPdfPolyfills.toString()})(self);`;
