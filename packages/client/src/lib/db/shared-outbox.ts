import {
  OfflineExecutor,
  OfflineTransactionAPI,
  OutboxManager,
  type CreateOfflineTransactionOptions,
  type KeyScheduler,
  type OfflineConfig,
  type OfflineTransaction,
} from "@tanstack/offline-transactions";
import { createTransaction, DuplicateTransactionIdError, type PendingMutation } from "@tanstack/db";
import type { OutboxStorage } from "~/lib/db/outbox-storage";
import { refetchLater, writeAccepted } from "~/lib/db/synced-writes";

type Settlement = { type: "settled"; id: string; error?: { name: string; message: string } };
type Message = { type: "queued" } | Settlement;

/** An edit this tab shows that the leader hasn't settled. */
type Unsettled = { mutations: PendingMutation[]; metadata: unknown };

/** Fields of the library's executor that are private there. */
type ExecutorInternals = {
  loadAndReplayTransactions?: () => Promise<void>;
  scheduler?: KeyScheduler;
};

const CHANNEL = "outbox";
const SETTLED_REMEMBERED = 1000;
const HELD_RECHECK_MS = 250;

const QUEUED: Message = { type: "queued" };

/**
 * Every tab of an origin queues its edits in one outbox, and the leader sends it, in the order the
 * edits were made. The library's executor only queues in the leader: anywhere else, or before the
 * leader is known, an edit was sent straight away and dropped if it couldn't be, so one made in a
 * second tab, offline or signed out, was lost. Here a tab that doesn't lead saves the edit to the
 * outbox's localStorage journal, which has landed before the tab can close, and tells the others.
 * The leader picks it up, sends it, and tells the tab once the server has it.
 *
 * An edit waits for the account that made it. `canSend` says whether the account now signed in
 * may send one, and `accountChanged` takes the others off screen and out of the queue until it can.
 */
export class SharedOutboxExecutor extends OfflineExecutor {
  readonly #outbox: OutboxManager | null;
  readonly #mutationFns: OfflineConfig["mutationFns"];
  readonly #canSend: (metadata: unknown) => boolean;
  readonly #channel: BroadcastChannel | null = null;
  readonly #unsettled = new Map<string, Unsettled>();
  /** Of `#unsettled`, the ones other tabs made. */
  readonly #restored = new Set<string>();
  readonly #settledElsewhere = new Set<string>();
  #reading: Promise<void> | null = null;
  #readAgain = false;

  constructor(
    config: OfflineConfig & { storage?: OutboxStorage; canSend: (metadata: unknown) => boolean },
  ) {
    // Set once this executor exists: the library calls it from the constructor's async start
    const leading = { onLead: () => {} };
    super({
      ...config,
      onLeadershipChange: (isLeader) => {
        config.onLeadershipChange?.(isLeader);
        if (isLeader) leading.onLead();
      },
    });
    leading.onLead = () => {
      // The library replays the outbox itself; this settles what it no longer holds
      void this.#settleSent();
      // The last leader may have sent edits and gone before it said so
      this.#channel?.postMessage(QUEUED);
    };
    this.#mutationFns = config.mutationFns;
    this.#canSend = config.canSend;
    const { storage, collections } = config;
    this.#outbox = storage
      ? new OutboxManager(
          {
            ...storage,
            // Only an edit that didn't fit the journal waits for IndexedDB; tell the others again
            // once it has landed there
            set: async (key, value) => {
              if (!(await storage.keep(key, value))) this.#channel?.postMessage(QUEUED);
            },
          },
          collections,
        )
      : null;
    // The prerender runs in Node, with no other tabs to hear from
    if (!this.#outbox || typeof window === "undefined") return;
    this.#channel = new BroadcastChannel(CHANNEL);
    this.#channel.addEventListener("message", ({ data }: MessageEvent<Message>) => {
      if (data.type === "settled") void this.#settle(data);
      else this.#pickUp();
    });
    // Frozen, it may have missed the leader settling its edits
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.#unsettled.size > 0) this.#pickUp();
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
    this.#forget(id);
    super.resolveTransaction(id, result);
    this.#announce({ type: "settled", id });
  }

  override rejectTransaction(id: string, error: Error) {
    this.#forget(id);
    super.rejectTransaction(id, error);
    this.#announce({ type: "settled", id, error: { name: error.name, message: error.message } });
  }

  override getPendingCount() {
    return this.isOfflineEnabled ? super.getPendingCount() : this.#unsettled.size;
  }

  /**
   * Takes the edits the account now signed in can't send off screen and out of the queue, where
   * they'd hold up its own, and lists the ones it now can: they stay in the outbox for theirs.
   */
  accountChanged() {
    this.#takeOffHeld();
    this.#pickUp();
  }

  #takeOffHeld() {
    const { scheduler } = this as unknown as ExecutorInternals;
    const held = (scheduler?.getAllPendingTransactions() ?? [])
      .filter((transaction) => !this.#canSend(transaction.metadata))
      .map((transaction) => transaction.id);
    const unqueued = scheduler?.removePendingTransactions(held) ?? [];
    const shown = [...this.#unsettled].filter(([, { metadata }]) => !this.#canSend(metadata));
    for (const id of new Set([...unqueued, ...shown.map(([id]) => id)])) this.#hide(id);
    // The one being sent stays until its attempt ends; refused, it would go back to the head of
    // the queue and hold up every edit behind it
    if (unqueued.length < held.length) setTimeout(() => this.#takeOffHeld(), HELD_RECHECK_MS);
  }

  /** Off screen, with no word to the other tabs: the edit isn't settled, only waiting. */
  #hide(id: string) {
    this.#forget(id);
    super.resolveTransaction(id, undefined);
  }

  #forget(id: string) {
    this.#unsettled.delete(id);
    this.#restored.delete(id);
  }

  async #queue(transaction: OfflineTransaction) {
    const { id, mutations, metadata } = transaction;
    this.#unsettled.set(id, { mutations, metadata });
    // Saved to the journal as it's called, so the others can read it once they hear
    const adding = this.#outbox!.add(transaction);
    this.#channel?.postMessage(QUEUED);
    await adding;
    // Queued as this tab became the leader, after it had read the outbox
    if (this.isOfflineEnabled) this.#pickUp();
  }

  #announce(settlement: Settlement) {
    if (this.isOfflineEnabled) this.#channel?.postMessage(settlement);
  }

  /**
   * Leading, sends what other tabs queued; otherwise shows it. Either way settles this tab's edits
   * that are gone from the outbox: the leader sent them, and this tab missed its word, closed or
   * frozen. One read at a time, and the last again.
   */
  #pickUp() {
    if (this.#reading) {
      this.#readAgain = true;
      return;
    }
    this.#reading = this.#read()
      .catch((err: unknown) => console.warn("[outbox] couldn't read the outbox:", err))
      .finally(() => {
        this.#reading = null;
        if (!this.#readAgain) return;
        this.#readAgain = false;
        this.#pickUp();
      });
  }

  async #read() {
    if (this.isOfflineEnabled) {
      const settling = this.#settleSent();
      await this.#replay();
      return settling;
    }
    const known = [...this.#unsettled.keys()];
    const queued = await this.#outbox!.getAll();
    this.#settleGone(known, queued);
    for (const transaction of queued) this.#restore(transaction);
  }

  /** Leading, only edits it made or showed before it led are in `#unsettled`. */
  async #settleSent() {
    const known = [...this.#unsettled.keys()];
    if (known.length === 0) return;
    try {
      this.#settleGone(known, await this.#outbox!.getAll());
    } catch (err) {
      console.warn("[outbox] couldn't read the outbox:", err);
    }
  }

  // What the library runs as a tab becomes the leader: it schedules each transaction it hasn't,
  // shows it, and sends the queue. Private in the library, which has no way to add to a running
  // executor's queue from storage.
  #replay() {
    const executor = this as unknown as ExecutorInternals;
    if (!executor.loadAndReplayTransactions)
      throw new Error("@tanstack/offline-transactions no longer replays the outbox this way");
    return executor.loadAndReplayTransactions();
  }

  /** Maybe refused, so the server's copy decides, not the edit. */
  #settleGone(known: string[], queued: OfflineTransaction[]) {
    const ids = new Set(queued.map((t) => t.id));
    for (const id of known) {
      const unsettled = this.#unsettled.get(id);
      if (!unsettled || ids.has(id)) continue;
      this.resolveTransaction(id, undefined);
      refetchLater(...new Set(unsettled.mutations.map((m) => m.collection)));
    }
  }

  #restore({ id, mutations, metadata, outboxPhase }: OfflineTransaction) {
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
    this.#unsettled.set(id, { mutations, metadata });
    this.#restored.add(id);
  }

  /** The leader settled an edit: the server's copy reaches this tab by its live events, later. */
  async #settle({ id, error }: Settlement) {
    const unsettled = this.#unsettled.get(id);
    if (!unsettled) {
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
      for (const mutation of unsettled.mutations) await writeAccepted(mutation);
    } catch (err) {
      console.warn(`[outbox] couldn't keep settled edit ${id} until its live event:`, err);
    }
    this.resolveTransaction(id, undefined);
  }
}
