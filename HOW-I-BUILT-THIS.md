# How I Created My First MCP and Turned It Into a Product

**By Rishi Banerjee**

> **TL;DR:** I noticed AI tools were wasting time and money because people write vague prompts. I built a tool that automatically turns messy prompts into structured instructions — no AI needed inside. Shipped it in under 2 weeks, listed it on 6+ directories, and monetized it at $4.99/mo and $9.99/mo using a freemium model. Total infrastructure cost: $0.

---

## Table of Contents

- [The Problem I Kept Running Into](#the-problem-i-kept-running-into)
- [The "Aha" Moment](#the-aha-moment)
- [What Is an MCP, and Why Should You Care?](#what-is-an-mcp-and-why-should-you-care)
- [Designing the Product](#designing-the-product)
- [Building It — With AI as My Co-Pilot](#building-it--with-ai-as-my-co-pilot)
- [The Hardest Problems to Solve](#the-hardest-problems-to-solve)
- [Monetization — Making It a Real Product](#monetization--making-it-a-real-product)
- [Distribution — Getting It in Front of People](#distribution--getting-it-in-front-of-people)
- [Hiccups, Headaches, and Hard Lessons](#hiccups-headaches-and-hard-lessons)
- [What's Next](#whats-next)
- [The Actual Timeline — 49 Hours, 21 Commits](#the-actual-timeline--49-hours-21-commits)
- [By the Numbers](#by-the-numbers)

---

## The Problem I Kept Running Into

I use AI constantly — for writing, coding, planning, research, emails. Claude is my daily driver. And I kept noticing the same pattern:

**People (including me) are terrible at telling AI what they actually want.**

"Make the code better." "Fix the login bug." "Write me a blog post." These sound reasonable. But they're the AI equivalent of walking into a restaurant and saying "give me food." You'll get *something*, but probably not what you wanted.

The result? Wasted iterations. Wasted tokens (which cost money). Wasted time going back and forth with the AI trying to clarify what you meant in the first place.

> **TL;DR:** Vague prompts → vague results → wasted money and time. Everyone knows this, but nobody systematically fixes their prompts before hitting Enter.

---

## The "Aha" Moment

I was reading about **Model Context Protocol (MCP)** — a new open standard from Anthropic that lets you extend Claude with custom tools. Think of it like plugins for AI: you can give Claude the ability to search databases, control your browser, call APIs, or — in my case — analyze and fix prompts before they execute.

The idea hit me: **what if there was a tool that sat between you and Claude, intercepting your sloppy prompt, scoring it, restructuring it, and compiling it into a professional instruction set — all before Claude even sees it?**

Like a spellchecker, but for AI prompts. And it would do this with zero AI calls — pure rules and algorithms. That way it's instant, free to run, and deterministic (same input always gives same output).

---

## What Is an MCP, and Why Should You Care?

Quick explainer for the non-technical crowd:

**MCP (Model Context Protocol)** is a standard that lets you give AI assistants new abilities. Normally, Claude can only chat with you. With MCP, you can give it "tools" — specific capabilities that it can call during a conversation.

My MCP gives Claude 11 new tools:
- **Optimize** — the main one. Analyzes your prompt, scores it, and rewrites it
- **Estimate cost** — tells you exactly how many tokens (and dollars) your prompt will burn
- **Compress context** — strips out irrelevant code/text you're about to send
- **Check** — quick pass/fail on whether your prompt is good enough
- And 7 more for configuration, stats, licensing, etc.

When you install my MCP, Claude can automatically use these tools. You type a vague prompt, Claude calls the optimizer, and you get back a structured, professional-grade prompt — before any work begins.

> **TL;DR:** An MCP is a plugin system for AI. Mine adds prompt quality control. Install it once, and Claude automatically upgrades your prompts.

---

## Designing the Product

### Core Principles

I set three non-negotiable rules before writing a single line of code:

1. **Zero AI calls inside.** The optimizer itself makes no API calls. All intelligence comes from rules, patterns, and scoring algorithms. This means it's instant, free to operate, and never produces hallucinated advice.

2. **Works for any LLM.** The same prompt compiles to different formats: Claude gets XML tags (`<role>`, `<goal>`, `<constraints>`), OpenAI gets system/user splits, and generic targets get Markdown headers. One prompt, three outputs.

3. **Freemium from day one.** Free users get 10 lifetime optimizations — enough to see the value. Pro at $4.99/mo gets 100/month. Power at $9.99/mo gets unlimited.

### The Pipeline

Every prompt goes through a 5-stage pipeline:

```
Your prompt → ANALYZE → SCORE → COMPILE → CHECKLIST → COST ESTIMATE
```

1. **Analyze** — What does the user actually want? Is this a coding task, a writing task, research, planning? What are the implicit assumptions? Are there blocking questions?
2. **Score** — Rate the prompt 0-100 across 5 dimensions: Clarity, Specificity, Completeness, Constraints, Efficiency
3. **Compile** — Restructure it with a role definition, success criteria, safety constraints, workflow steps, and uncertainty policies
4. **Checklist** — 9-point structural coverage check (does it have a goal? constraints? inputs? outputs?)
5. **Cost Estimate** — Exact token counts and dollar costs across 8 models from 3 providers

Average improvement: **+32 points.** A vague prompt scoring 48/100 comes out at 90/100 after compilation.

> **TL;DR:** Five deterministic stages turn any prompt from amateur to professional. No AI used in the process — pure pattern matching and rules.

---

## Building It — With AI as My Co-Pilot

Here's the irony: I built a prompt optimization tool *using* the AI it's designed to help.

The entire project was built with **Claude Code** — Anthropic's AI coding agent. I wrote the architecture, designed the interfaces, and specified what each module should do. Claude wrote the implementation, tests, and documentation.

### The Stack

- **TypeScript** — type safety for a rules engine is non-negotiable
- **MCP SDK** — the official Anthropic library for building MCP servers
- **Zod** — runtime schema validation for all tool inputs
- **Node.js crypto** — Ed25519 signatures for license keys (zero external dependencies)
- **No database.** Local file storage in `~/.prompt-optimizer/`

That's it. Two runtime dependencies: the MCP SDK and Zod. Everything else is Node.js built-ins.

### Timeline

Here's the actual git log — the real story is that this was built in 3 intense sessions, not 2 weeks:

- **Session 1 (Feb 26, 1am–7pm):** 11 commits. Started at 1:18am with the initial server. By 3am, the full pipeline (analyzer, scorer, compiler, estimator) worked and could handle any prompt type. After a break, came back at 3pm to ship the npm package, add audience/tone/platform detection, and publish v1.2.
- **Session 2 (Feb 27, 8pm–11pm):** 3 commits. The big one — v2.1.0 landed with the 3-tier freemium model, Ed25519 license system, 11 tools, persistent storage. Polished docs and pushed the live release to npm.
- **Session 3 (Feb 28, 12am–2am):** 7 commits. Programmatic API, dual entry points, E2E tests, landing page, MCP Registry publication, directory submissions to 6+ platforms, and these writeup docs.

**Elapsed time:** 49 hours from first commit to last. **Active coding:** ~10 hours across 3 sessions. The rest was sleeping, eating, and living life.

> **TL;DR:** 49 hours wall clock, ~10 hours active. 21 commits. Two dependencies, zero infrastructure cost. Built with Claude Code as my pair programmer.

---

## The Hardest Problems to Solve

### 1. Detecting What People Actually Mean

"Write a post about my MCP" — is that a coding task or a writing task? The word "post" could mean a blog post, a social media post, or a POST API endpoint.

I built a three-layer detection system:
- First, look for **output type** keywords ("post", "article", "tweet" → writing)
- Then, run **full-prompt pattern** matching for code/debug/refactor signals
- Finally, **fallback heuristics** that catch edge cases

The intent-first approach handles conversational prompts that keyword matchers miss.

### 2. Scoring Without Being Arbitrary

It would be easy to slap a score on a prompt and call it a day. But people would immediately ask "why did I get a 48?" and you'd better have a real answer.

Each score breaks down into 5 dimensions × 20 points. Every point deducted has a specific reason. "Vague objective" costs you clarity points. "No constraints specified" costs you constraint points. The math is transparent and reproducible.

### 3. Offline License Validation

Most products phone home to check if you've paid. I didn't want that. My users might be on planes, behind corporate VPNs, or philosophically opposed to telemetry.

Solution: **Ed25519 cryptographic signatures.** I sign each license key with a private key (kept secret). The optimizer verifies the signature using only the public key (embedded in the code). No internet required. No server to maintain. No external dependency.

The trade-off: if I ever lose the private key, I can't generate new licenses. And if I regenerate the key pair, all existing licenses become invalid. High stakes, but clean design.

### 4. The Freemium Gate

How do you meter usage fairly without a server? Local file storage tracks usage counts, but what stops someone from deleting the file?

Answer: nothing. And that's fine. The free tier is a funnel, not a prison. If someone wants to hack around the limit, they're technical enough to have opinions about the product. The license system handles the actual paywall for Pro/Power features.

> **TL;DR:** Intent detection, transparent scoring, offline licensing, and honest freemium design. Each one was harder than it looks.

---

## Monetization — Making It a Real Product

### Pricing

| Tier | Price | What You Get |
|------|-------|-------------|
| **Free** | $0 | 10 lifetime optimizations |
| **Pro** | $4.99/mo | 100/month, 30 requests/min |
| **Power** | $9.99/mo | Unlimited, 60 requests/min, always-on mode |

### Payment Infrastructure

I used **Lemon Squeezy** as the payment processor — it handles subscriptions, tax compliance, and checkout pages. Total cost: $0 until someone pays (they take a percentage of sales, no upfront fee).

### The Purchase Flow

1. User hits the free tier limit → the optimizer shows upgrade options with direct checkout links
2. User completes checkout on Lemon Squeezy
3. I generate a signed license key (a cryptographic string)
4. User enters the license key in Claude → `set_license` tool validates it offline
5. Tier upgrades instantly — no server round-trip, no "checking your subscription" delay

The entire activation happens locally. The license key contains the tier, expiration date, and a cryptographic signature. Nothing else — no email, no name, no tracking.

> **TL;DR:** $0 infrastructure. Lemon Squeezy handles payments. License keys validate offline with cryptography. Privacy-first: no email or name in the key.

---

## Distribution — Getting It in Front of People

Building the product is half the job. Distribution is the other half.

### Where It's Listed (as of launch)

| Channel | Type | Status |
|---------|------|--------|
| **npm** | Package registry | ✅ Published (`claude-prompt-optimizer-mcp`) |
| **Official MCP Registry** | Anthropic's official directory | ✅ Published |
| **Glama** | MCP server directory (17,000+ servers) | ✅ Submitted for review |
| **mcp.so** | Community directory | ✅ Submitted (GitHub issue) |
| **PulseMCP** | MCP news/directory | ✅ Auto-ingested from Official Registry |
| **awesome-mcp-servers** | GitHub curated list (most popular) | ✅ PR submitted |
| **GitHub** | Source code + landing page | ✅ Public repo + GitHub Pages site |

### Install Methods

Four ways to install, from simplest to most control:

1. **MCP Config** — paste 5 lines of JSON into your settings file
2. **npx** — `npx -y claude-prompt-optimizer-mcp` (one command, no install)
3. **npm global** — `npm install -g claude-prompt-optimizer-mcp`
4. **curl** — `curl -fsSL .../install.sh | bash` (detects your OS, prints config)

### Landing Page

A dark-themed landing page on GitHub Pages with an interactive before/after demo showing a vague prompt (score: 38) being compiled into structured XML (score: 91). Pure HTML/CSS, no JavaScript framework. Loads in under 1 second.

> **TL;DR:** Listed on 6+ directories, 4 install methods, a landing page, and zero hosting costs (GitHub Pages is free).

---

## Hiccups, Headaches, and Hard Lessons

### The npm Token Saga

Every. Single. Time. I tried to publish to npm, the auth token would fail with a cryptic "one-time password required" error. The issue? npm has three types of tokens — Publish (needs OTP), Read-only, and Automation (no OTP). I kept accidentally using the wrong one across sessions.

**Lesson learned:** I documented the exact token type and recovery steps in the project docs so no future session makes the same mistake.

### The Key Rotation Emergency

I regenerated my Ed25519 key pair during development... forgetting that I'd already generated test license keys with the old pair. Suddenly no licenses validated. The private key signs, the public key verifies, and they must match. New key pair = all old keys are dead.

**Lesson learned:** Key management is a one-way door. Document it, back it up, and never regenerate casually.

### Smithery's ESM Incompatibility

Smithery (one of the major MCP directories) uses an internal bundler that forces all code into an older JavaScript format (CommonJS). My project uses the modern format (ESM) with features like top-level `await` that physically can't run in CJS. Build error. No workaround.

**Lesson learned:** Not every distribution channel will support your tech choices. Ship what you can, document the rest.

### The MCP Registry's mcpName Requirement

The Official MCP Registry requires a special field (`mcpName`) in your npm package. But you have to publish to npm *first* with that field, *then* publish to the registry. I discovered this after multiple failed attempts. Had to bump to v2.2.2 just to add one metadata field.

**Lesson learned:** Read the entire docs before starting a submission pipeline. Version bumps are cheap; frustration is expensive.

> **TL;DR:** npm tokens are confusing, key rotation is irreversible, not all directories support modern JavaScript, and always RTFM before submitting to registries.

---

## What's Next

- **Phase B:** Move storage from local files to the cloud (Cloudflare Workers + Supabase). Same tool interfaces, just swap the storage layer. Already architected with an abstract interface for this exact purpose.
- **More integrations:** Cline, Cursor, Windsurf — anywhere MCP is supported.
- **Competitive moat:** The deterministic rules engine gets better with every edge case I discover. The scoring dimensions, compiler templates, and ambiguity detectors are the product's compound knowledge.

---

## The Actual Timeline — 49 Hours, 21 Commits

Most "how I built this" posts hand-wave the timeline. Here's the actual git history — every commit, timestamped.

### Day 1 — Feb 26: From Zero to Published (11 commits)

| Time (IST) | What Happened |
|------------|---------------|
| **1:18am** | First commit. Initial MCP server with the 5-stage pipeline. |
| **1:28am** | Full README with 6 examples and tool documentation. |
| **1:57am** | Made the optimizer universal — supports all prompt types, not just code. |
| **2:03am** | Docs alignment pass. |
| **2:09am** | Added non-code examples: writing, research, planning showcases. |
| **2:58am** | Fixed the big bug: intent-first detection so "write a post about my MCP" doesn't misclassify as code. |
| **3:01am** | Docs alignment. Then **went to sleep.** |
| **3:19pm** | Woke up. Published to npm. Added benchmarks. Repositioned README. |
| **6:52pm** | v1.2 — audience/tone/platform detection, goal enrichment, new rules. |
| **6:57pm** | README aligned with v1.2. |
| **7:01pm** | Credited a contributor for PR #1. |

**Day 1 summary:** 5 hours 43 minutes of active work. Went from zero to a published npm package with a full pipeline, 6 examples, and universal prompt support.

### Day 2 — Feb 27: The Freemium & License System (3 commits)

| Time (IST) | What Happened |
|------------|---------------|
| **8:34pm** | The monster commit: v2.1.0. 3-tier freemium, Ed25519 license keys, 11 tools, persistent storage, rate limiting. All in one session. |
| **9:02pm** | Polished all docs for the live release. |
| **11:28pm** | Version bump to v2.1.1 for npm README update. |

**Day 2 summary:** 2 hours 54 minutes. The entire monetization layer — from metering to cryptographic license validation — built in a single sitting.

### Day 3 — Feb 28: API, Distribution, and Launch (7 commits)

| Time (IST) | What Happened |
|------------|---------------|
| **12:27am** | v2.2.0 — programmatic API, dual entry points, curl installer, E2E tests (129 total). |
| **1:10am** | Landing page live on GitHub Pages. New keypair generated. |
| **1:17am** | v2.2.1 — published new Ed25519 public key to npm. |
| **1:22am** | Added npm publish instructions to CLAUDE.md (so future sessions don't fight token issues). |
| **1:42am** | v2.2.2 — MCP Registry listing + directory submissions to 6 platforms. |
| **1:46am** | Added interactive before/after demo to the landing page. |
| **2:16am** | These "How I Built This" docs. MCP config fixes. Done. |

**Day 3 summary:** 1 hour 49 minutes. Programmatic API, E2E test suite, landing page, published to the Official MCP Registry, submitted to 6 directories, and wrote the retrospective.

### The Math

| Metric | Value |
|--------|-------|
| **First commit** | Feb 26, 2026 at 1:18am IST |
| **Last commit** | Feb 28, 2026 at 2:16am IST |
| **Wall clock elapsed** | ~49 hours |
| **Active coding sessions** | 3 |
| **Total active time** | ~10 hours 26 minutes |
| **Total commits** | 21 |
| **Avg time between commits** | ~14 minutes (during active sessions) |

Three late-night sessions. Ten hours of actual work. One AI pair programmer. Zero infrastructure cost.

> **TL;DR:** 49 hours from first keystroke to "listed on 6 directories." But only ~10 hours of that was active coding. The rest was sleep, food, and life. Claude Code wrote the implementation; I designed the architecture and made the decisions.

---

## By the Numbers

| Metric | Value |
|--------|-------|
| **Time to build** | ~10 hours active across 3 sessions (49 hours wall clock) |
| **Lines of code** | ~4,000 (TypeScript) |
| **Test suite** | 129 tests across 9 files |
| **Runtime dependencies** | 2 (MCP SDK + Zod) |
| **Monthly infrastructure cost** | $0 |
| **MCP tools** | 11 |
| **Scoring dimensions** | 5 × 20 = 100 max |
| **Output targets** | 3 (Claude, OpenAI, Generic) |
| **Cost models covered** | 8 models across 3 providers |
| **Install methods** | 4 |
| **Directory listings** | 6+ |
| **Average score improvement** | +32 points |
| **AI calls made by the optimizer** | 0 |

---

*Built with Claude Code in ~10 hours of active coding across 3 late-night sessions. 21 commits. Shipped on npm. Listed on 6+ directories. Total cost: $0.*
