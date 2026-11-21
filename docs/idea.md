# NearShelf: the idea (Open Agentic Web Challenge)

> **Status:** idea only, ready for your approval (20 Nov 2026). No code and no build plan, as you asked.
> **Name:** NearShelf (your choice). "OpenCounter" was dropped because it is an existing permitting-software product (Accela, 2024).

## Context

You want to enter Cognizant's **Open Agentic Web Challenge** on Devpost. The deadline is 11 Jan 2027, 16:00 UTC (9:30 pm IST). Your starting idea is that every medicine shop and spare-parts dealer has its own agent. Before leaving home, a person asks their own agent, and it checks with the shop agents whether the item is in stock. Stock comes from the shop's billing system, so nobody has to phone around.

**Your key insight:** hotel rooms are already visible online, but what is on a local shop's shelf is not.

This document turns that into a stronger, judge-ready idea. It is based on:
- the MVP spec (Profile 0.3, 18 Nov 2026)
- the hub repo's README and linking guide
- the reference runtime's cross-site actions doc
- the Devpost page, rules, updates and resources
- the repo's GitHub discussions and issues
- worldwideagenticweb.org and its FAQ
- Cognizant's launch and negotiation blog posts
- MIT's WebAgentica page and NANDA Index

**What the rules mean for the idea:**
- **Stage One is pass/fail conformance.** The site must have a conforming network JSON, a browser runtime and an interface, and it must work with its own site. LLM settings and other-site links are optional, but they score in Stage Two.
- **Stage Two has four equally weighted criteria.** Ties go to Technological Implementation first, so deep, correct use of the spec matters.
- **Judges may score from the video, text and screenshots alone.** So the story must land in under 2 minutes.
- **The site must stay free and open for judges.** So it needs a default model that works without a key; maintainers confirmed a site may pay for one. The visitor's own key stays as an option. **Decided:** NearShelf pays for a small default with a hard spending cap until judging ends.
- **No rule bars medicines or vehicle parts.** But no third-party trademarks in the video, and no real patient or prescription data.
- **Open source isn't strictly required,** but the FAQ assumes it. Open-sourcing everything is the safe choice.
- **Winners will be announced at Davos (January 2027).**

---

## 1. The problem

- **Stock in millions of small shops is invisible.** Airlines, hotels and big chains publish availability. The neighbourhood chemist and the spare-parts dealer don't.
- **So people search by hand.** They phone shop after shop, if they even have the numbers, or go from shop to shop. It hurts most when it matters most:
  - a child's fever at 11 pm
  - a medicine in short supply
  - a bike stuck at the mechanic, waiting for one part
- **The information already exists.** Every sale goes through the shop's billing software, which knows what is on the shelf right now. Nobody can ask it.
- **Today's fixes all put a company in the middle:**
  - **Marketplaces:** the shop pays commission, and the customer becomes the platform's customer.
  - **Directory "get quotes" forms:** your phone number goes to ten vendors, and all of them call you.
  - **Closed "see what's in store" features:** they only work with certain billing systems, only inside one company's search, and no outside agent can ask them.
- **Numbers to cite (verify before submitting):**
  - India has about 10–12 lakh licensed chemists, and about 89% are independent stores.
  - Billing software is already common in pharmacies. One leading pharmacy-billing vendor claims more than 1.75 lakh chemist users (the vendor's own figure).
  - India's auto aftermarket is about US$11.8B (2025) and spread across many small dealers.
  - In UK and US shortage surveys, patients report trying pharmacy after pharmacy.

## 2. The idea in one breath

**Every shop gets its own agent, on its own website, answering from its own billing system. Every person gets a personal agent in their browser that asks those shop agents on their behalf.** Your details stay private, there is no marketplace in the middle, no commission and no phone calls.

**Shops pay nothing for AI when shoppers' agents ask them.** The shopper's browser runs the shop's agent on whatever AI the shopper's agent uses: a small default paid by NearShelf, or the shopper's own provider. This is exactly how the open agentic web is designed to work. On the shop's own website, visitors can bring their own AI, or the shop or a directory host can fund a tiny default model.

> "Your agent asks around, so you don't have to. Shops stay independent."

### Why it stands out in this hackathon (from the forum and repo sweep)

- **The organizers' examples show one business.** The guesthouse, harbour-tours and pizza sites each have an agent and partner links. NearShelf shows **many competing shops answering the same question, live from billing**, plus referrals between them.
- **Nobody else covers this space yet.** The visible entries are 7 listed sites, 2 pending, and a few in discussions. None of them covers pharmacies, spare parts, or live stock lookup.
- **Trust, verification and agent directories are already crowded** (5 of the 7 listed sites). So NearShelf **reuses** community tools, such as conformance/trust checkers and signed manifests, instead of competing with them. Its own directory lists **places** (shops with location, category and hours), not agent sites.
- **It answers a gap the community found.** A community crawl found that only 4 of 46 agent networks share live reads with other sites (repo issue #53). Live, shareable stock is exactly NearShelf's core.
- **It matches what the maintainers want.** A maintainer said what matters most is that websites can talk to each other. NearShelf is built from websites talking to each other: shopper → shops → partner shops → parts catalogue → clinic.
- **It is the organizers' own story.** The challenge's FAQ worries that platform-tied agents could hide small retailers behind bigger chains. Judge Babak Hodjat said at launch: *"Every business should be discoverable, not just those with access to closed platforms."* ([Cognizant launch post](https://www.cognizant.com/us/en/ai-lab/blog/open-agentic-web-challenge), 12 Nov 2026). NearShelf makes a small shop's actual shelf discoverable to any agent.
- **It is on the Resources page's idea list.** One suggested idea is a site that books, compares or negotiates by talking to other agentic sites. NearShelf compares and holds, and can optionally negotiate (feature 11).
- **NANDA Index has no pharmacies or parts dealers yet** (searched Nov 2026). It even has a small-business entry type, so NearShelf shops would be the first.
- **It matches other launch speakers.** Agents should record their sources: every NearShelf answer names its shop and time. Users should be able to inspect what agents do: NearShelf has an activity panel and a consent card.

### How it scores on each judging criterion

| Criterion | The one-sentence case |
|---|---|
| Technological Implementation (tie-breaker) | Every MVP interoperability check happens naturally inside one story: published networks, browser runtime, default and own-key AI, live grounded reads, cross-site loading with consent, private data kept home, honest failures, and limits. It also uses extensions: cross-site holds, generated forms, NANDA Index, and the arbiter. |
| Design | Three finished sides: a shopper app that is search-first rather than a chatbot, shop websites with a billing counter, and a shopkeeper dashboard. Every action shows what is sent and where. |
| Potential Impact | Lakhs of independent chemists and parts dealers, and shoppers at their most urgent moments: night-time, shortages, breakdowns. The kit, directory format and answer vocabulary let any town repeat it. |
| Quality of the Idea | The billing system becomes the catalogue. Competing shops cooperate through referrals. Privacy replaces lead-selling. The agent knows exactly what to ask for (part fitment, medicine composition). |

## 3. Three sides, one network

| Who | What they do | What they get |
|---|---|---|
| **Shopper** | Opens their personal agent page and types or says *"Children's paracetamol syrup, open now, near me"* or *"Clutch cable for my scooter."* | One clear answer: who has it, price, distance, open until when, and when the stock was last checked. They can hold the item with one tap. |
| **Shopkeeper** | Keeps billing as usual. Their billing system quietly keeps the shop agent up to date. | New walk-in customers, holds, referrals from partner shops, and a list of items people asked for that they didn't have. Zero AI cost and no catalogue to maintain. |
| **Other agent websites** | A clinic, a garage, a hospital discharge desk, or another shop calls the shop agents as part of its own job. | Their visitors get stock answers without leaving their site. This creates network effects. |

**The "personal agent" in plain words:** a web page you open on your phone or laptop. It runs inside your browser and uses the AI provider you choose. It remembers three things on your device only: your area, your vehicles ("My garage") and your regular medicines ("My list").

## 4. What makes it better than the starting idea

These additions are the heart of the refinement. They come in three layers, so the scope can shrink to fit the team and time. Team size and time get settled when we plan the build.

- **Must (the pharmacy act):** 1, 2, 3, 4, 7
- **Should (completes the product):** 6 (the parts act), 8, 9, 10
- **Could (if time allows):** 5, 11, the clinic caller, language and voice

The parts act is the first thing to shrink, down to a 15-second proof, but it is never cut. It proves the template works for any shop.

1. **Live from the billing counter.**
   - Shop agents answer only from the shop's current stock, synced from its billing software.
   - When the last strip is billed at the counter, the very next answer says "out of stock".
   - Every answer shows its time, for example "as of 10:44 pm, from the shop's billing".
   - The shopkeeper never maintains a separate catalogue.
   - **Demo vs real:** in the demo, a simple billing-counter screen stands in for the shop's billing software, and the video says so. In a real shop, a small sync helper would send stock updates every few minutes, or on every sale where the billing software allows it.
2. **Ask once, and your agent asks around.**
   - The agent picks a smart shortlist of about 4 shops per round: right type of shop, open now, nearest, verified.
   - It asks each one, then shows a comparison. If none has the item, it asks "Check a few more?"
   - This mirrors how a person calls 3–4 shops, and it protects shops from spam.
   - It also fits the runtime's per-message limits, so a constraint becomes a design feature.
3. **Hold it for me.**
   - One tap opens the shop's own window, where you type your name and phone. They go straight to the shop and never pass through any agent.
   - You get a hold code, for example "Held until closing (11 pm), code H-4821".
   - **Prescription medicines are hold-only.** The pharmacist checks the prescription at the counter.
4. **Out of stock? The shop refers you.**
   - If a shop doesn't have the item, its agent can ask its own partner shops, with your OK, and point you to one that does.
   - Chemists and parts dealers already do this informally by phone. The shop keeps your goodwill instead of hitting a dead end.
5. **Whole list, fewest stops.**
   - Paste a prescription list or a mechanic's parts list.
   - The agent finds the fewest shops that cover everything, for example: "Shop A has 4 of your 5. Shop B, 300 m away, has the fifth."
6. **Knows exactly what to ask for.**
   - **Parts:** the agent turns "clutch cable, 2019 scooter" into the exact part number by asking a parts-catalogue agent. Only then does it ask the dealers, so you no longer have to carry the old part to show them.
   - **Medicines:** the agent understands brand versus composition (the salt). It may show "same composition available at X" as information only, with "ask your doctor or pharmacist before switching". It never gives dosage or medical advice.
7. **Private by design (no lead-selling).**
   - Shops see only what was asked, not who asked, unless the shopper chooses to hold an item.
   - Your saved details (area, medicine list, vehicles) stay on your device and are never sent to shops. Only the AI provider handling the request sees what you ask. In default mode that is NearShelf's AI account; with your own key, it is only your chosen provider. The settings panel always shows which mode is on.
   - Before anything is sent, a card shows exactly what will be sent.
8. **Missed-demand insights for the shopkeeper.**
   - A weekly list of what people asked for that the shop didn't have, so it can restock.
   - It holds item names only, never people. This gives shops a real reason to join.
9. **Open neighbourhood directory, with verification.**
   - A simple public list of shop agents for an area, like a phone book for agents. A market association, a city or a community group can host one, and a personal agent can follow several.
   - Pharmacies show a "license verified" badge with who verified it.
   - Entries can optionally be registered on NANDA Index so agents can find and verify one another.
10. **Agentify a shop in minutes.**
    - A starter kit with three steps: pick a shop type, upload the stock export from your billing software, fill in hours and policies. The result is a shop agent website that follows the spec.
    - It is shared openly with the community.
11. **Fair quote round (parts only; stretch goal).**
    - For a bigger part, such as a clutch kit or headlamp, a few dealers send sealed quotes.
    - Quotes cover more than price: genuine or compatible part, warranty, and ready-by time.
    - Dealers never see your budget. Plain code, not the AI, picks the fair result, and you approve before anything is final.
    - This follows judge Babak Hodjat's Nov 19 "arbiter" post, which the organizers sent to all participants. Medicines are never negotiated.

**Smaller touches:**
- Ask in your own language, and shop agents answer in it. Voice input is optional.
- The shopper side is search-first with result cards, not a chatbot. The shopkeeper side has no chat at all. The spec explicitly invites agentic sites that are not chatbots.

## 5. How it fits the spec (idea level, no implementation)

| Spec piece | Where it shows up in NearShelf |
|---|---|
| Public agent network JSON + `agent-manifest.json` (required) | Every shop site and the personal-agent site publish one. All shop sites come from one shared shop template. |
| Browser runtime, visitor's AI (required) | Shop agents run inside the shopper's browser on the shopper's AI (NearShelf's funded default or the shopper's own key), so shops pay nothing for AI. |
| LLM / key settings (optional in rules) | A funded default works with no key. The shopper can switch to their own provider, model and key, which never reaches any shop (a spec MUST). |
| Grounded capability via site action or MCP (interop check) | The shop's live stock read and hold request. On the demo counter screen, billing changes stock. The stock itself lives in the shop's own small backend, fed by billing; the agents still run in the browser (the challenge FAQ allows backend services). |
| Loading another site's network (peer protocol) | Shopper agent → shop agents. Shop → partner shop (referral). Parts-catalogue agent for part numbers. Clinic → pharmacies. |
| Cross-site reads and writes (bridge, a spec extension) | The live stock read is shared with callers. Holds open in the shop's own window, so personal details go straight to the shop. |
| Consent before contact | A card shows the shop's name and the exact request. One explicit tap can allow "ask verified shops in my area for this search"; the spec allows this only as the user's explicit choice. |
| Private context, deny-by-default | Location, medicine list and vehicles stay with the shopper and are never forwarded to shops. |
| Honest outcomes, fail closed | An unreachable shop shows "couldn't reach". A hold timeout shows "unknown, call the shop". No stock claim is made without a timestamped answer from the shop. |
| Execution limits | Shortlist rounds of a few shops per question. The skill's runtime allows 4 partner calls per message today; the newest nsdeploy raised it to 12. |
| Observable execution | An activity panel shows which shops were asked, what was sent and what came back. |
| Optional extras | Generated forms and tables (CRUSE) for result cards and hold forms. NANDA Index small-business entries (domain-verified) for discovery. The spec's negotiation-and-arbitration extension for the parts quote round. MCP as an alternative stock channel for shops that run a server. |

**How it meets the rules' "interact" requirement:**
- **With the website:** live stock and holds.
- **With other agentic websites:** shop-to-shop referrals and the parts catalogue.
- **Called by other agentic websites:** the personal agent and the clinic call shop agents.

## 6. The demo world and the 2-minute story

**Demo world (my call):** a fictional neighbourhood, "Neem Chowk", with fictional shops, vehicle brands and medicine brands. This keeps us inside the rule against third-party trademarks; generic medicine names are fine. It has:
- 3 pharmacies:
  - "Shanti Medical", open till 11 pm
  - "Night Owl Pharmacy", open 24 hours
  - "Jeevan Chemist", closes at 9 pm
- 2 parts dealers
- 1 parts-catalogue site
- 1 clinic (nice-to-show)
- the neighbourhood directory
- the personal-agent site

All shop sites are generated with the kit from sample billing exports in a common export format. The description says plainly that the shops and data are fictional.

**Video, under 2 minutes, narrated in your own voice:**

| Time | Scene |
|---|---|
| 0:00–0:15 | **Hook:** "In India, every shop visit starts with *Bhaiya, hai kya?* (Do you have it?). Hotel rooms are online, but the medicine on your chemist's shelf isn't." A parent is phoning shops at night. |
| 0:15–0:50 | 10:45 pm, **on the personal-agent site**. The parent asks for "children's paracetamol syrup, open now". Jeevan Chemist is skipped because it is closed. The consent card shows what is sent to the two open shops: no name, no location. Shanti Medical has it ("few left, as of 10:44"); Night Owl is out. The parent taps **Hold**, types their details in Shanti's own window and gets a hold code. |
| 0:50–1:15 | **Split screen, on Shanti Medical's own website.** Left: Shanti's billing counter sells its last ORS packs to a walk-in. Right: a second shopper asks Shanti's site agent for ORS. The answer flips to "just sold out (10:52)", and Shanti's agent asks its partner Night Owl, which has ORS: "want me to hold one there?" This one scene shows live sync, a shop's own site, and shop-to-shop calls. |
| 1:15–1:40 | **Second act:** "My 2019 scooter needs a clutch cable." The catalogue agent resolves the exact part, 2 dealers are asked and one has it. |
| 1:40–1:55 | **Shopkeeper view:** the missed-demand list, then "agentify your shop in 3 steps". |
| 1:55–2:00 | **Close:** "Your agent asks around. Shops stay independent. Built on the open agentic web." |

## 7. Guardrails (non-negotiable)

- No diagnosis, dosage or medical advice.
- No online sale of prescription medicines: hold only, prescription checked in person.
- Never invent stock. Every availability claim comes from the shop's timestamped answer.
- Personal details never pass through agents. Holds collect them in the shop's own window.
- Neutral ranking by stock, distance, open hours and price. No paid placement.
- Only verified pharmacies appear by default. Unverified shops are clearly labelled.
- No real patient or prescription data anywhere, including in the demo.

## 8. Goals, non-goals, anti-goals

**Goals**
- A complete product with three sides (shopper, shopkeeper, other sites), not a chatbot demo.
- Show every interoperability check in the spec naturally inside one believable story.
- Ship reusable building blocks that other teams can use.

**Non-goals (this version)**
- Delivery, payments, or acting as an e-pharmacy.
- A central database or marketplace.
- Background alerts like "notify me when back in stock". The spec's runtime only works while the page is open, so this would need a hosted service later.

**Anti-goals (a failure even if it technically works)**
- The agent says "in stock" and the shelf is empty.
- A shopper's phone number or identity leaks to shops.
- Shops get flooded with agent questions.
- It drifts into health advice.
- It looks like a chatbot on fake data with no believable shop side.

## 9. What we share with the community

This counts under the "Potential Impact" judging criterion.

1. **Shop agent template and "agentify from billing export" kit**, for any shop type: pharmacy, parts, hardware, electronics.
2. **Open directory format for places**, plus an example directory. It lists local shops with location, category, hours and license, not generic agent sites. Anyone can host one, and agents can follow several. It can feed existing community directories, trust checkers and NANDA Index rather than duplicating them.
3. **Availability answer vocabulary** that reuses schema.org's existing availability terms (InStock, LimitedAvailability, OutOfStock), plus an "as of" time and stock bands. Every shop agent then answers in the same shape.
4. **"Verified shops" consent pattern:** one explicit choice per search, with every request still visible.
5. **A short guide:** running a regulated category like pharmacies safely on the open agentic web.

## 10. Prior art, and how we differ

| Today | Limitation | NearShelf |
|---|---|---|
| Calling or walking around | Slow, worst at night or during shortages | The agent asks for you, in seconds |
| Marketplaces and e-pharmacies | Commission, and the shop loses the customer | The shop's own site; no middleman |
| Directory "get quotes" forms | Your number goes to many vendors | Shops don't learn who asked unless you hold an item |
| Local-inventory feed services (Google's Local Inventory app, formerly Pointy; NearSt in the UK) | Stock shows only inside big platforms' search, often for a monthly fee, from certain billing systems only, and no outside agent can ask it | Open, shop-owned, any agent can ask, works from any billing export |
| ONDC (India's open commerce network) | Open, but catalogue onboarding is heavy for mom-and-pop shops; retail volumes reported uneven | Agent-native, starts from the billing export, no seller app needed; could connect to ONDC later |

## 11. Risks, and how the idea answers them

| Risk | Answer |
|---|---|
| Stale or wrong stock | Billing sync, an "as of" time on every answer, and the hold as the real confirmation |
| Shops don't join | Zero AI cost, zero catalogue work, missed-demand insights, referrals, and it's their own website |
| Shoppers or judges won't paste an AI key | **Decided:** NearShelf pays for a small default model with a hard spending cap until judging ends (~19 Jan), using the hackathon's Otari credits if available; maintainers confirmed this is allowed. Your own key or one-click provider connect stays as the option. Shops pay nothing when shoppers' agents ask them. |
| The reference runtime is changing fast (limits raised; internals being replaced) | The idea relies only on the spec's public behaviour, not on one runtime's internals |
| Pharmacy regulation | Hold-only, no advice, verified pharmacies only |
| Fake or manipulative shop agents | Verified directory, structured stock answers, and shops can't see the shopper or steer the ranking (the spec treats other sites' agents as untrusted) |
| Shops don't want rivals seeing exact stock | Stock bands by default (plenty / few left / out); exact counts are opt-in |

## 12. Decisions: yours vs mine

**Yours (decided):**
- **Hero category:** pharmacy first, with spare parts as a short second act
- **Real pilot shop:** not likely, so all shops and data are fictional
- **Setting:** India-first
- **Name:** NearShelf ("OpenCounter" was dropped because it is an existing product)
- **Default AI model:** NearShelf pays for a small default with a hard spending cap until judging ends (~19 Jan), using the hackathon's Otari credits if available. The visitor's own key stays as an option.
- **Where this document lives:** `C:\Projects\open_agent\docs\idea.md`

**My calls (change any):**
- the fictional "Neem Chowk" demo world
- stock bands by default
- a shortlist of about 4 shops per round
- hold instead of buy, with no payments
- a search-first interface with chat for follow-ups

## 13. How we'll know the idea is ready (idea-level check)

- [ ] **Submission fit:** each required element maps to the idea. This means the public JSON, the runtime, the interface, LLM settings, and interaction with the site, with other sites, and being called by other sites (see section 5).
- [ ] **Judging fit:** the scoring table in section 2 still holds after any changes, and each claim is visible in the demo.
- [ ] **Story fit:** the demo tells the story in under 2 minutes, with 3 "wow" moments: live counter sync, the privacy card, and the referral.
- [ ] **Guardrail fit:** every guardrail has a visible moment in the demo.
- [ ] **Reality check (optional):** you said a real shop is unlikely, so the demo stays fictional and the description says so. If a chance does come up, even one chemist's answers help a lot. Ask: Which billing software do you use? Would you share stock bands? Would you refer customers to a partner shop? Otherwise, the published evidence in section 1 carries the impact case.
- [ ] **Video stands alone:** a judge who never opens the site still understands the problem, the idea and the three "wow" moments.
- [ ] **Organizer sanity check:** pitch the idea in one of the challenge's office hours (more time zones were promised) and adjust to the feedback.
- [ ] **If using Otari:** the submission form asks for your Otari account email, plus one or two sentences on a problem you hit with Otari and how it could improve.
