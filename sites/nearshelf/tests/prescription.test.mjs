// The prescription photo reader, with a scripted AI provider.
import assert from "node:assert/strict";
import test from "node:test";
import { LlmClient } from "../runtime/llm.js";
import { fitSize, MOST_LINES, MOST_PHOTO_BYTES, parseReading, PrescriptionError, PrescriptionReader, readableError, shrinkPhoto, waitFor } from "../js/prescription.js";

const PHOTO = "data:image/jpeg;base64,AAAA";
const LINE = { name: "Azithromycin", strength: "500 mg", form: "tablet", amount: "3", unsure: false };
const ANSWER = JSON.stringify({ readable: true, medicines: [LINE] });

/**
 * A reader with a scripted AI client.
 *
 * :param chat: The client's chat method.
 * :param options: {llm, waitMs, modelOverride}, where llm overrides the client's fields.
 * :return: The reader.
 */
function reader(chat, { llm = {}, waitMs = 1000, modelOverride = "vision-model" } = {}) {
  const engine = { modelOverride, callerModel: () => "site-model", top: { llm: { baseUrl: "https://ai.example/v1", apiKey: "test-key", mock: false, chat, ...llm } } };
  return new PrescriptionReader({ engine: () => engine, shrink: async () => PHOTO, waitMs });
}

test("the photo goes to the visitor's provider once, with the model they chose", async () => {
  const calls = [];
  const scan = reader(async (request) => {
    calls.push(request);
    return { content: ANSWER };
  });
  assert.equal(scan.setup().host, "ai.example");
  assert.equal(reader(null, { modelOverride: "" }).setup().model, "site-model");
  assert.deepEqual(await scan.read({}), [LINE]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "vision-model");
  assert.equal(calls[0].tools, undefined);
  assert.equal(calls[0].messages[1].content[1].image_url.url, PHOTO);
});

test("the runtime's AI client sends the photo in the request and keeps it out of its trace", async (t) => {
  let sent;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    sent = { url, body: JSON.parse(options.body), auth: options.headers.Authorization };
    const chunk = { choices: [{ delta: { content: ANSWER }, finish_reason: "stop" }], model: "vision-model" };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
  });
  const traced = [];
  const keep = (...args) => {
    traced.push(args);
    return "span";
  };
  const llm = new LlmClient({ baseUrl: "https://ai.example/v1", apiKey: "test-key", mock: false, trace: { start: keep, update: keep, end: keep, fail: keep } });
  const scan = new PrescriptionReader({ engine: () => ({ callerModel: () => "vision-model", top: { llm } }), shrink: async () => PHOTO });
  assert.deepEqual(await scan.read({}), [LINE]);
  assert.equal(sent.url, "https://ai.example/v1/chat/completions");
  assert.equal(sent.auth, "Bearer test-key");
  assert.equal(sent.body.messages[1].content[1].image_url.url, PHOTO);
  assert.ok(traced.length > 0);
  assert.ok(!JSON.stringify(traced).includes(PHOTO));
});

test("no photo is sent without a real provider", async () => {
  for (const llm of [{ apiKey: "" }, { apiKey: "demo" }, { mock: true }]) {
    let calls = 0;
    const scan = reader(async () => {
      calls += 1;
    }, { llm });
    await assert.rejects(scan.read({}), /Add an AI provider key/);
    assert.equal(calls, 0);
  }
  await assert.rejects(new PrescriptionReader({ engine: () => null }).read({}), /not ready/);
});

test("an answer keeps only clean medicine fields, once each, and doubts anything unclear", () => {
  const medicines = [
    { name: "  Dolo\n650 ", strength: "650 mg", form: "tablet", amount: 10, dose: "twice a day", patient: "Asha" },
    { name: "dolo 650", strength: "650 MG", form: "Tablet", unsure: false },
    { name: "", strength: "5 mg" },
    null,
    { name: { bad: true } },
  ];
  const text = `\`\`\`json\n${JSON.stringify({ readable: true, medicines })}\n\`\`\``;
  assert.deepEqual(parseReading(text), [{ name: "Dolo 650", strength: "650 mg", form: "tablet", amount: "10", unsure: true }]);
  const many = { medicines: Array.from({ length: 40 }, (_, index) => ({ name: `Item ${index}` })) };
  assert.equal(parseReading(JSON.stringify(many)).length, MOST_LINES);
});

test("an unusable answer is refused", () => {
  for (const text of ["", "I cannot see images", "[]", "{}", "{bad}", null]) {
    assert.throws(() => parseReading(text), PrescriptionError);
  }
  assert.throws(() => parseReading('{"readable": false, "medicines": [{"name": "X"}]}'), /No medicine names/);
});

test("provider errors become plain words, without the provider's raw answer", async () => {
  for (const [status, words] of [[400, /may not read photos/], [401, /refused the key/], [429, /limit/], [503, /busy/]]) {
    const error = readableError(new Error(`LLM HTTP ${status}: raw answer`));
    assert.match(error.message, words);
    assert.ok(!error.message.includes("raw answer"));
  }
  assert.match(readableError(new TypeError("Failed to fetch")).message, /could not be reached/);
  // AbortSignal.timeout does not keep Node running by itself.
  const alive = setTimeout(() => {}, 5000);
  const slow = reader(({ signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason));
  }), { waitMs: 10 });
  await assert.rejects(slow.read({}), /too long/);
  clearTimeout(alive);
});

test("photos are checked first, and shrunk without changing their shape", async () => {
  assert.deepEqual(fitSize(4000, 3000), { width: 1600, height: 1200 });
  assert.deepEqual(fitSize(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitSize(1, 9000), { width: 1, height: 1600 });
  await assert.rejects(shrinkPhoto(null), /Choose a JPG/);
  await assert.rejects(shrinkPhoto({ type: "application/pdf", size: 1 }), /Choose a JPG/);
  await assert.rejects(shrinkPhoto({ type: "image/png", size: MOST_PHOTO_BYTES + 1 }), /too large/);
});

test("a model on this computer gets longer to answer than an online one", () => {
  for (const host of ["localhost:11434", "127.0.0.1:11434", "[::1]:11434"]) {
    assert.equal(waitFor(host), 300000);
  }
  for (const host of ["ai.example", "localhost.example.com"]) {
    assert.equal(waitFor(host), 60000);
  }
});
