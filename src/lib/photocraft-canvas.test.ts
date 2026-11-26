import { afterEach, describe, expect, it } from "vitest";
import { PhotoCraftCanvasBridge } from "./photocraft-canvas";

const originalWindow = globalThis.window;

function installFakeWindow() {
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const fakeWindow = {
    location: { origin: "http://localhost" },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setTimeout: (callback: TimerHandler) => {
      const id = nextTimer++;
      if (typeof callback === "function") timers.set(id, callback as () => void);
      return id;
    },
    clearTimeout: (id: number) => { timers.delete(id); },
  };
  globalThis.window = fakeWindow as unknown as Window & typeof globalThis;
  return () => [...timers.values()].forEach((callback) => callback());
}

afterEach(() => {
  globalThis.window = originalWindow;
});

describe("PhotoCraftCanvasBridge", () => {
  it("waiter yang sudah dilepas tidak mengubah kanvas sehat menjadi error", async () => {
    const flushTimers = installFakeWindow();
    const bridge = new PhotoCraftCanvasBridge();
    bridge.attach({} as HTMLIFrameElement);
    const waiter = bridge.whenReady(10);
    bridge.detach();

    flushTimers();
    await expect(waiter).resolves.toBeUndefined();
  });
});
