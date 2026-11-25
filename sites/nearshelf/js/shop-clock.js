// Gives each shop its own time to answer, so one slow shop cannot use up the whole turn.

/**
 * The time limit for one shop's agent network in one turn.
 *
 * When time is up, the shop's model call is aborted, its later agents are skipped and its
 * website actions are refused. The clock stops for good once the shop starts an action that
 * changes something, such as a hold: the visitor confirms that in the shop's own window, and
 * giving up halfway would hide whether it happened.
 */
export class ShopClock {
  /** How long one shop may take for one item, in milliseconds. */
  static SHOP_MS = 90_000;

  /** How much longer it may take for each further item. */
  static MORE_MS = 45_000;

  /** How many items a shop is asked about: (ref) => count. Set by site.js. */
  static items = () => 1;

  /** How long a whole turn may take: four shops, the runtime's most, and NearShelf's own steps. */
  static TURN_MS = 1_200_000;

  /** How a timed-out shop's trace error starts. */
  static TOO_SLOW = "No answer in";

  /** Checks a request before a shop gets it: (ref, text) => {text} or {refusal}. Set by site.js. */
  static check = (ref, text) => ({ text });

  /** Completes a shop tool's arguments: (ref, action, args) => args. Set by site.js. */
  static complete = (ref, action, args) => args;

  /** Gets what a shop's tool answered: (ref, action, args, result). Set by site.js. */
  static heard = () => {};

  /** Adds checked facts to a shop's answer: (ref, text) => text. Set by site.js. */
  static answered = (ref, text) => text;

  /** Each running shop's clock, by the composition its contexts share. */
  static running = new WeakMap();

  /**
   * Put a limit on every shop the engine asks, and a longer one on the whole turn.
   *
   * :param engine: The runtime engine.
   */
  static install(engine) {
    const makeCtx = engine._makeCtx.bind(engine);
    engine._makeCtx = (options) => {
      const ctx = makeCtx(options);
      if (options.isTop) {
        if (ctx.composition) {
          ctx.composition.deadline = Date.now() + ShopClock.TURN_MS;
        }
        const resolve = ctx.resolveRemote;
        ctx.resolveRemote = (...args) => ShopClock.resolve(resolve, args);
      } else if (ctx.composition) {
        ShopClock.running.get(ctx.composition)?.limit(ctx);
      }
      return ctx;
    };
  }

  /**
   * Load a shop's network under a new clock, and keep that clock for asking it.
   *
   * :param resolve: The context's own resolveRemote.
   * :param args: Its arguments.
   * :return: A session whose invoke is limited.
   */
  static async resolve(resolve, args) {
    const clock = new ShopClock(args[0]);
    const session = await clock.race(resolve(...args));
    if (session === clock.message) {
      return { invoke: async () => clock.message };
    }
    return {
      invoke: async (request, options) => {
        const checked = ShopClock.check(args[0], request?.user_message?.text ?? "");
        if (checked.refusal) {
          clock.stop();
          return checked.refusal;
        }
        if (request?.user_message) {
          request.user_message.text = checked.text;
        }
        const composition = clock.share(options.composition);
        const answer = await clock.race(session.invoke(request, { ...options, composition }));
        clock.stop();
        if (answer === clock.message) {
          return answer;
        }
        return typeof answer === "string"
          ? ShopClock.answered(args[0], answer)
          : { ...answer, text: ShopClock.answered(args[0], answer.text ?? "") };
      },
    };
  }

  /**
   * :param ref: The shop's network address.
   */
  constructor(ref) {
    this.ref = ref;
    const limit = ShopClock.SHOP_MS + ShopClock.MORE_MS * Math.max(0, ShopClock.items(ref) - 1);
    this.abort = new AbortController();
    this.deadline = Date.now() + limit;
    // A partner's reply that starts with "Skipped" means it did not answer.
    this.message = `Skipped: no answer in ${limit / 1000} seconds. Ask the next open shop now. Do not retry this one.`;
    this.timeUp = new Promise((done) => {
      this.timer = setTimeout(() => {
        this.abort.abort(new Error(`${ShopClock.TOO_SLOW} ${limit / 1000} seconds`));
        done(this.message);
      }, limit);
    });
  }

  /** Stop counting: the shop answered, or it is acting. */
  stop() {
    clearTimeout(this.timer);
    this.deadline = Infinity;
  }

  /**
   * Wait for work, or for time to run out.
   *
   * :param work: The promise to wait for.
   * :return: The work's result, or the timeout message.
   */
  async race(work) {
    // An abandoned promise may still fail after time is up; that is not an error here.
    work.catch(() => {});
    try {
      const result = await Promise.race([work, this.timeUp]);
      return this.abort.signal.aborted ? this.message : result;
    } catch (error) {
      if (this.abort.signal.aborted) {
        return this.message;
      }
      this.stop();
      throw error;
    }
  }

  /**
   * The turn's shared budget, with this shop's deadline when it is sooner.
   *
   * :param composition: The turn's budget. Its counters stay shared.
   * :return: The same budget, as this shop sees it.
   */
  share(composition) {
    const shared = new Proxy(composition || {}, {
      get: (target, key) => (key === "deadline" ? Math.min(target.deadline ?? Infinity, this.deadline) : target[key]),
    });
    ShopClock.running.set(shared, this);
    return shared;
  }

  /**
   * Make a shop's context stop when time is up.
   *
   * :param ctx: The shop network's context.
   */
  limit(ctx) {
    const { signal } = this.abort;
    const { llm, actions, externalRunner } = ctx;
    ctx.llm = Object.create(llm, { chat: { value: (call) => llm.chat({ ...call, signal }) } });
    if (externalRunner) {
      ctx.externalRunner = (local, name, text, span, chain, helpers) => externalRunner(local, name, text, span, chain, {
        ...helpers,
        runInterruptibleModelCall: async (control, call) => ({ interrupted: false, value: await call(signal) }),
      });
    }
    ctx.actions = Object.create(actions, {
      execute: {
        value: async (plan, ...rest) => {
          // After time is up, nothing may be held for a visitor who has moved on.
          signal.throwIfAborted();
          if (plan.some(({ entry }) => entry.effect !== "read")) {
            this.stop();
          }
          const full = plan.map((step) => ({ ...step, args: ShopClock.complete(this.ref, step.entry.name, step.args) }));
          const receipts = await actions.execute(full, ...rest);
          (receipts || []).forEach((receipt, index) => {
            if (receipt.status === "succeeded" && !signal.aborted) {
              ShopClock.heard(this.ref, full[index].entry.name, full[index].args, receipt.result);
            }
          });
          return receipts;
        },
      },
    });
  }
}
