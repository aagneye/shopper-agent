// Checks the time limit for each shop, with the runtime's own budget functions.
// Run: node --test "sites/nearshelf/tests/*.test.mjs"
import assert from "node:assert/strict";
import test from "node:test";
import { ShopClock } from "../js/shop-clock.js";
import { consumeAgentBudget } from "../runtime/runner.js";

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * An engine with one shop, which runs the given work with its limited context.
 *
 * :param work: What the shop does.
 * :param performed: Collects the actions that really ran.
 * :return: The top context and its budget.
 */
function setUp(work, performed = []) {
  const actions = {
    execute: async (plan) => {
      performed.push(...plan);
      return [];
    },
  };
  const llm = {
    chat: ({ signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
  };
  const engine = {
    _makeCtx: (options) => ({
      ...options,
      llm,
      actions,
      resolveRemote: async () => ({ invoke: (request, { composition }) => work(engine._makeCtx({ composition })) }),
    }),
  };
  ShopClock.install(engine);
  const composition = { deadline: 0, agentCalls: 0, maxAgentCalls: 24 };
  return { top: engine._makeCtx({ isTop: true, composition }), composition };
}

async function askShop({ top, composition }) {
  return (await top.resolveRemote("shop")).invoke({}, { composition });
}

test.beforeEach(() => {
  ShopClock.SHOP_MS = 200;
});

test("a turn gets the long limit and a quick shop answers normally", async () => {
  const run = setUp(async (ctx) => {
    assert.equal(consumeAgentBudget(ctx.composition), null);
    return { text: "in stock" };
  });
  assert.ok(run.composition.deadline > Date.now() + 1_190_000);
  assert.deepEqual(await askShop(run), { text: "in stock" });
  assert.equal(run.composition.agentCalls, 1);
});

test("a slow shop is skipped, its model call aborted and its later work refused", async () => {
  const performed = [];
  let late;
  let error;
  const run = setUp(async (ctx) => {
    late = ctx;
    try {
      await ctx.llm.chat({});
    } catch (failure) {
      error = failure;
    }
    return "Error from shop";
  }, performed);
  assert.match(await askShop(run), /^Skipped: no answer/);
  await wait(20);
  assert.match(error.message, /^No answer in/);
  await assert.rejects(late.actions.execute([{ entry: { effect: "irreversible" } }]), /No answer in/);
  assert.equal(performed.length, 0);
});

test("a shop asked about more items gets more time", async () => {
  ShopClock.MORE_MS = 200;
  ShopClock.items = (ref) => (ref === "shop" ? 3 : 1);
  const run = setUp(async () => {
    await wait(400);
    return "ok";
  });
  assert.equal(await askShop(run), "ok");
  ShopClock.items = () => 1;
  assert.match(await askShop(run), /^Skipped/);
});

test("a failed shop is not a timeout, and each shop gets a new clock", async () => {
  const broken = setUp(async () => {
    throw new Error("broken");
  });
  await assert.rejects(askShop(broken), /broken/);
  const run = setUp(async () => {
    await wait(120);
    return "ok";
  });
  assert.equal(await askShop(run), "ok");
  assert.equal(await askShop(run), "ok");
});

test("a shop that has started a hold is not timed, but one only reading is", async () => {
  const act = (effect) => setUp(async (ctx) => {
    await ctx.actions.execute([{ entry: { effect } }]);
    await wait(400);
    return "done";
  });
  assert.equal(await askShop(act("irreversible")), "done");
  assert.match(await askShop(act("read")), /^Skipped/);
});

test("a shop that does not load is skipped", async () => {
  const engine = { _makeCtx: (options) => ({ ...options, resolveRemote: () => new Promise(() => {}) }) };
  ShopClock.install(engine);
  const top = engine._makeCtx({ isTop: true, composition: {} });
  assert.match(await (await top.resolveRemote("shop")).invoke({}, {}), /^Skipped/);
});
