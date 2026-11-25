import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { openEventStream } from "~/lib/sync/stream-url";

class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static opened: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;

  constructor(readonly url: string) {
    super();
    FakeEventSource.opened.push(this);
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }

  emit(type: string) {
    if (type === "open") this.readyState = FakeEventSource.OPEN;
    this.dispatchEvent(new MessageEvent(type, { data: "" }));
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.opened = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("a stream that falls silent is closed and reported lost, so changes don't stop arriving", () => {
  const onLost = vi.fn();
  openEventStream("https://sync.example/api/events?ticket=t", {}, onLost);
  const [source] = FakeEventSource.opened;
  source.emit("open");

  vi.advanceTimersByTime(60_000);
  source.emit("heartbeat");
  vi.advanceTimersByTime(60_000);
  expect(onLost).not.toHaveBeenCalled();

  vi.advanceTimersByTime(20_000);
  expect(onLost).toHaveBeenCalledOnce();
  expect(source.readyState).toBe(FakeEventSource.CLOSED);
});

test("an error closes the stream rather than letting it retry with its spent ticket", () => {
  const onLost = vi.fn();
  openEventStream("https://sync.example/api/events?ticket=t", {}, onLost);
  const [source] = FakeEventSource.opened;
  source.emit("open");

  source.emit("error");
  expect(source.readyState).toBe(FakeEventSource.CLOSED);
  vi.advanceTimersByTime(120_000);
  expect(onLost).toHaveBeenCalledOnce();
});
