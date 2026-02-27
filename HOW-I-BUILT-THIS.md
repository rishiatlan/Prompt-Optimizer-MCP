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

- **Days 1-3:** Architecture and core pipeline (analyzer, scorer, compiler, estimator)
- **Days 4-6:** MCP tool layer, freemium gating, storage
- **Days 7-8:** License system (Ed25519 cryptographic validation)
- **Days 9-10:** Programmatic API, dual entry points, testing (129 tests)
- **Days 11-12:** Landing page, distribution, directory submissions
- **Days 13-14:** Polish, pricing setup on Lemon Squeezy, go-live

> **TL;DR:** Two weeks, two dependencies, zero infrastructure cost. Built with Claude Code as my pair programmer.

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

## By the Numbers

| Metric | Value |
|--------|-------|
| **Time to build** | ~2 weeks |
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

*Built with Claude Code. Shipped on npm. Listed everywhere. Total cost: $0 and two weekends of focus.*
