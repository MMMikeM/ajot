import {
  OfflineExecutor,
  OfflineTransactionAPI,
  OutboxManager,
  type CreateOfflineTransactionOptions,
  type OfflineConfig,
  type OfflineTransaction,
} from "@tanstack/offline-transactions";
import { createTransaction, DuplicateTransactionIdError, type PendingMutation } from "@tanstack/db";
import { isQueuedElsewhere, type OutboxStorage } from "~/lib/db/outbox-storage";
import { writeAccepted } from "~/lib/db/synced-writes";

type Settlement = { type: "settled"; id: string; error?: { name: string; message: string } };
type Message = { type: "queued" } | Settlement;

const CHANNEL = "outbox";
const SETTLED_REMEMBERED = 1000;

/**
 * Every tab of an origin queues its edits in one outbox, and the leader sends it, in the order the
 * edits were made. The library's executor only queues in the leader: anywhere else, or before the
 * leader is known, an edit was sent straight away and dropped if it couldn't be, so one made in a
 * second tab, offline or signed out, was lost. Here a tab that doesn't lead saves the edit to the
 * outbox, and the leader picks it up from the `storage` event of its journal write, which lands even
 * if the tab closes straight away. The leader tells the tab once the server has it.
 */
export class SharedOutboxExecutor extends OfflineExecutor {
  readonly #outbox: OutboxManager | null;
  readonly #mutationFns: OfflineConfig["mutationFns"];
  readonly #channel: BroadcastChannel | null = null;
  /** Edits this tab shows that the leader hasn't settled: its own, and other tabs' it restored. */
  readonly #unsettled = new Map<string, PendingMutation[]>();
  readonly #restored = new Set<string>();
  readonly #settledElsewhere = new Set<string>();
  #reading: Promise<void> | null = null;
  #readAgain = false;

  constructor(config: OfflineConfig & { storage?: OutboxStorage }) {
    super(config);
    this.#mutationFns = config.mutationFns;
    const { storage, collections } = config;
    this.#outbox = storage
      ? new OutboxManager({ ...storage, set: storage.keep }, collections)
      : null;
    // The prerender runs in Node, with no other tabs to hear from
    if (!this.#outbox || typeof window === "undefined") return;
    this.#channel = new BroadcastChannel(CHANNEL);
    this.#channel.addEventListener("message", ({ data }: MessageEvent<Message>) => {
      if (data.type === "settled") void this.#settle(data);
      else this.#pickUp();
    });
    window.addEventListener("storage", (event) => {
      if (isQueuedElsewhere(event)) this.#pickUp();
    });
    this.waitForInit().then(() => {
      if (!this.isOfflineEnabled) this.#pickUp();
    }, console.error);
  }

  override createOfflineTransaction(options: CreateOfflineTransactionOptions) {
    const mutationFn = this.#mutationFns[options.mutationFnName];
    if (this.isOfflineEnabled || !this.#outbox || !mutationFn)
      return super.createOfflineTransaction(options);
    return new OfflineTransactionAPI(
      options,
      mutationFn,
      (transaction) => this.#queue(transaction),
      this,
    );
  }

  override resolveTransaction(id: string, result: unknown) {
    this.#unsettled.delete(id);
    this.#restored.delete(id);
    super.resolveTransaction(id, result);
    this.#announce({ type: "settled", id });
  }

  override rejectTransaction(id: string, error: Error) {
    this.#unsettled.delete(id);
    this.#restored.delete(id);
    super.rejectTransaction(id, error);
    this.#announce({ type: "settled", id, error: { name: error.name, message: error.message } });
  }

  override getPendingCount() {
    return this.isOfflineEnabled ? super.getPendingCount() : this.#unsettled.size;
  }

  async #queue(transaction: OfflineTransaction) {
    this.#unsettled.set(transaction.id, transaction.mutations);
    await this.#outbox!.add(transaction);
    this.#channel?.postMessage({ type: "queued" } satisfies Message);
    // Queued as this tab became the leader, after it had read the outbox
    if (this.isOfflineEnabled) this.#pickUp();
  }

  #announce(settlement: Settlement) {
    if (this.isOfflineEnabled) this.#channel?.postMessage(settlement);
  }

  /** Sends what other tabs queued, or, not leading, shows it. One read at a time, the last again. */
  #pickUp() {
    if (this.#reading) {
      this.#readAgain = true;
      return;
    }
    this.#reading = (this.isOfflineEnabled ? this.#replay() : this.#showQueued())
      .catch((err: unknown) => console.warn("[outbox] couldn't read the outbox:", err))
      .finally(() => {
        this.#reading = null;
        if (!this.#readAgain) return;
        this.#readAgain = false;
        this.#pickUp();
      });
  }

  // What the library runs as a tab becomes the leader: it schedules each transaction it hasn't,
  // shows it, and sends the queue. Private in the library, which has no way to add to a running
  // executor's queue from storage.
  #replay() {
    const executor = this as unknown as { loadAndReplayTransactions?: () => Promise<void> };
    if (!executor.loadAndReplayTransactions)
      throw new Error("@tanstack/offline-transactions no longer replays the outbox this way");
    return executor.loadAndReplayTransactions();
  }

  /** Shows other tabs' queued edits here too, as the leader does, until it settles them. */
  async #showQueued() {
    const queued = await this.#outbox!.getAll();
    const ids = new Set(queued.map((t) => t.id));
    // Settled while this tab wasn't listening, and maybe refused, so its live events tell
    for (const id of this.#restored) if (!ids.has(id)) this.resolveTransaction(id, undefined);
    for (const transaction of queued) this.#restore(transaction);
  }

  #restore({ id, mutations, outboxPhase }: OfflineTransaction) {
    if (outboxPhase || mutations.length === 0) return;
    if (this.#unsettled.has(id) || this.#settledElsewhere.has(id)) return;
    const restoration = createTransaction({ id, autoCommit: false, mutationFn: async () => {} });
    restoration.applyMutations(mutations);
    try {
      for (const { collection } of mutations)
        if (collection._state.trackTransaction(restoration))
          collection._state.recomputeOptimisticState(true);
    } catch (err) {
      restoration.rollback({ isSecondaryRollback: true });
      if (!(err instanceof DuplicateTransactionIdError))
        console.warn(`[outbox] couldn't show queued edit ${id}:`, err);
      return;
    }
    this.registerRestorationTransaction(id, restoration);
    this.#unsettled.set(id, mutations);
    this.#restored.add(id);
  }

  /** The leader settled an edit: the server's copy reaches this tab by its live events, later. */
  async #settle({ id, error }: Settlement) {
    const mutations = this.#unsettled.get(id);
    if (!mutations) {
      this.#settledElsewhere.add(id);
      if (this.#settledElsewhere.size > SETTLED_REMEMBERED)
        this.#settledElsewhere.delete(this.#settledElsewhere.values().next().value!);
      return;
    }
    if (error) {
      this.rejectTransaction(id, Object.assign(new Error(error.message), { name: error.name }));
      return;
    }
    try {
      for (const mutation of mutations) await writeAccepted(mutation);
    } catch (err) {
      console.warn(`[outbox] couldn't keep settled edit ${id} until its live event:`, err);
    }
    this.resolveTransaction(id, undefined);
  }
}
