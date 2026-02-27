// tools.ts — MCP tool registrations for the prompt optimizer v2.1.
// 11 tools total. Metered: optimize_prompt, refine_prompt. Free: all others.
// Build-mode invariants enforced: I1 (deterministic ordering), I2 (request_id on all),
// I3 (metering-after-success), I4 (rate limit via canUseOptimization), I5 (degraded health in response).

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { analyzePrompt, detectTaskType } from './analyzer.js';
import { compilePrompt, compressContext } from './compiler.js';
import { scorePrompt, generateChecklist } from './scorer.js';
import { estimateCost, estimateCostForText } from './estimator.js';
import { createSession, getSession, updateSession } from './session.js';
import { createRequestId, log } from './logger.js';
import { runRules } from './rules.js';
import { sortCountsDescKeyAsc, sortIssues } from './sort.js';
import type {
  PreviewPack, StorageInterface, RateLimiter, ExecutionContext,
  OutputTarget, OptimizerConfig, Tier, LicenseData,
} from './types.js';
import { PLAN_LIMITS } from './types.js';
import { validateLicenseKey } from './license.js';

// ─── Input Hardening ─────────────────────────────────────────────────────────

function hardenInput(input: string): string {
  return input
    .replace(/\0/g, '')                                    // null byte removal
    .replace(/\s{50,}/g, match => match.slice(0, 50));     // whitespace cap
}

// ─── Response Helpers ────────────────────────────────────────────────────────

function jsonResponse(data: unknown) {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(data, null, 2),
    }],
  };
}

function errorResponse(data: { request_id: string; error: string; message: string; [key: string]: unknown }) {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(data, null, 2),
    }],
    isError: true,
  };
}

// ─── Purchase URLs (Lemon Squeezy checkout) ─────────────────────────────────

export const PRO_PURCHASE_URL = 'https://rishibanerjee.lemonsqueezy.com/checkout/buy/16bb57a4-a9a5-4bee-a476-b7d998481506';
export const POWER_PURCHASE_URL = 'https://rishibanerjee.lemonsqueezy.com/checkout/buy/14eff7b8-6773-4a8f-9540-83553dad11ad';

// ─── Strictness Threshold Map ────────────────────────────────────────────────

const STRICTNESS_THRESHOLDS: Record<string, number> = {
  relaxed: 40,
  standard: 60,
  strict: 75,
};

// ─── Tool Registrations ──────────────────────────────────────────────────────

export function registerTools(
  server: McpServer,
  storage: StorageInterface,
  rateLimiter: RateLimiter,
): void {

  /** Build an ExecutionContext for the current request. */
  async function buildCtx(): Promise<ExecutionContext> {
    const requestId = createRequestId();
    const config = await storage.getConfig();
    const usage = await storage.getUsage();
    return {
      requestId,
      storage,
      logger: log,
      config,
      rateLimiter,
      tier: usage.tier,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Tool 1: optimize_prompt (METERED)
  // ══════════════════════════════════════════════════════════════════════════════

  server.tool(
    'optimize_prompt',
    'Analyze a raw prompt, detect ambiguities, compile an optimized version, score quality, and estimate cost across providers. Returns a PreviewPack for review.',
    {
      raw_prompt: z.string().min(1).max(102400).describe('The raw user prompt to optimize'),
      context: z.string().max(102400).optional().describe('Optional context: repo info, file contents, preferences'),
      target: z.enum(['claude', 'openai', 'generic']).default('claude').describe('Output target: claude (XML), openai (system/user), generic (markdown)'),
    },
    async ({ raw_prompt, context, target }) => {
      const ctx = await buildCtx();
      const { requestId } = ctx;

      try {
        // Harden inputs
        raw_prompt = hardenInput(raw_prompt);
        if (context) context = hardenInput(context);

        // Use config default_target if none specified
        const outputTarget: OutputTarget = target || ctx.config.default_target;

        // Freemium gate (I4: rate limit enforced inside canUseOptimization)
        const enforcement = await storage.canUseOptimization(ctx);
        if (!enforcement.allowed) {
          const isRateLimit = enforcement.enforcement === 'rate';
          return jsonResponse({
            request_id: requestId,
            error: isRateLimit ? 'rate_limited' : 'free_tier_limit_reached',
            enforcement: enforcement.enforcement,
            remaining: enforcement.remaining,
            limits: enforcement.limits,
            tier: enforcement.usage.tier,
            ...(enforcement.retry_after_seconds != null && {
              retry_after_seconds: enforcement.retry_after_seconds,
            }),
            ...(!isRateLimit && {
              pro_purchase_url: PRO_PURCHASE_URL,
              power_purchase_url: POWER_PURCHASE_URL,
              next_step: 'You\'ve hit your plan limit. Upgrade to Pro ($4.99/mo) or Power ($9.99/mo) for more optimizations — then run set_license with your key.',
            }),
          });
        }

        // Storage health check (I5)
        const storageHealth = await storage.health();
        if (storageHealth === 'degraded') {
          log.warn(requestId, 'Storage degraded — proceeding with fail-open (Phase A)');
        }

        // Pipeline
        const intentSpec = analyzePrompt(raw_prompt, context);
        const qualityBefore = scorePrompt(intentSpec, context);
        const { prompt: compiledPrompt, changes } = compilePrompt(intentSpec, context, outputTarget);
        const checklist = generateChecklist(compiledPrompt);
        const costEstimate = estimateCost(
          compiledPrompt + (context || ''),
          intentSpec.task_type,
          intentSpec.risk_level,
          outputTarget,
        );

        // Create session
        const session = await createSession(storage, {
          raw_prompt,
          context,
          target: outputTarget,
          intent_spec: intentSpec,
          compiled_prompt: compiledPrompt,
          quality_before: qualityBefore,
          compilation_checklist: checklist,
          cost_estimate: costEstimate,
        });

        // State depends on blocking questions
        const state = intentSpec.blocking_questions.length > 0 ? 'ANALYZING' : 'COMPILED';
        await updateSession(storage, session.id, { state });

        // Build PreviewPack (I2: request_id on all responses)
        const preview: PreviewPack = {
          request_id: requestId,
          session_id: session.id,
          state,
          intent_spec: intentSpec,
          quality_before: qualityBefore,
          compiled_prompt: compiledPrompt,
          compilation_checklist: checklist,
          blocking_questions: intentSpec.blocking_questions,
          assumptions: intentSpec.assumptions,
          cost_estimate: costEstimate,
          model_recommendation: costEstimate.recommended_model,
          changes_made: changes,
          target: outputTarget,
          format_version: 1,
          scoring_version: 2,
          ...(storageHealth === 'degraded' && { storage_health: 'degraded' }),
        };

        // I3: Metering-after-success — only increment if pipeline succeeded
        let success = false;
        try {
          // All 4 conditions met: validation passed, compiler succeeded, no error, no rate denial
          success = true;
        } finally {
          if (success) {
            await storage.incrementUsage();
            await storage.updateStats({
              type: 'optimize',
              score_before: qualityBefore.total,
              task_type: intentSpec.task_type,
              blocking_questions: intentSpec.blocking_questions.map(q => q.question),
              cost_savings_usd: costEstimate.costs.length > 1
                ? Math.max(0, costEstimate.costs[costEstimate.costs.length - 1].total_cost_usd - costEstimate.costs[0].total_cost_usd)
                : 0,
            });
          }
        }

        log.info(requestId, `optimize_prompt: score=${qualityBefore.total}, target=${outputTarget}, task=${intentSpec.task_type}`);
        log.prompt(requestId, 'raw_prompt', raw_prompt);

        return jsonResponse(preview);
      } catch (err) {
        log.error(requestId, 'optimize_prompt failed:', err instanceof Error ? err.message : String(err));
        return errorResponse({
          request_id: requestId,
          error: 'internal_error',
          message: `optimize_prompt failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        });
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════════════════
  // Tool 2: refine_prompt (METERED)
  // ══════════════════════════════════════════════════════════════════════════════

  server.tool(
    'refine_prompt',
    'Refine a prompt by answering blocking questions or providing manual edits. Re-runs analysis and returns updated PreviewPack.',
    {
      session_id: z.string().regex(/^[a-zA-Z0-9-]+$/).describe('Session ID from optimize_prompt'),
      answers: z.record(z.string(), z.string()).optional().describe('Answers to blocking questions: { question_id: answer }'),
      edits: z.string().optional().describe('Manual edits or additional context to incorporate'),
      target: z.enum(['claude', 'openai', 'generic']).optional().describe('Change output target'),
    },
    async ({ session_id, answers, edits, target }) => {
      const ctx = await buildCtx();
      const { requestId } = ctx;

      try {
        // Freemium gate (I4)
        const enforcement = await storage.canUseOptimization(ctx);
        if (!enforcement.allowed) {
          const isRateLimit = enforcement.enforcement === 'rate';
          return jsonResponse({
            request_id: requestId,
            error: isRateLimit ? 'rate_limited' : 'free_tier_limit_reached',
            enforcement: enforcement.enforcement,
            remaining: enforcement.remaining,
            limits: enforcement.limits,
            tier: enforcement.usage.tier,
            ...(enforcement.retry_after_seconds != null && {
              retry_after_seconds: enforcement.retry_after_seconds,
            }),
            ...(!isRateLimit && {
              pro_purchase_url: PRO_PURCHASE_URL,
              power_purchase_url: POWER_PURCHASE_URL,
              next_step: 'You\'ve hit your plan limit. Upgrade to Pro ($4.99/mo) or Power ($9.99/mo) for more optimizations — then run set_license with your key.',
            }),
          });
        }

        const session = await getSession(storage, session_id);
        if (!session) {
          return errorResponse({
            request_id: requestId,
            error: 'session_not_found',
            message: 'Session not found or expired.',
          });
        }

        const storageHealth = await storage.health();
        if (storageHealth === 'degraded') {
          log.warn(requestId, 'Storage degraded — proceeding with fail-open (Phase A)');
        }

        // Merge answers
        if (answers) {
          Object.assign(session.answers, answers);
        }

        // Build enriched prompt
        let enrichedPrompt = session.raw_prompt;
        if (answers && Object.keys(answers).length > 0) {
          const answerText = Object.entries(answers)
            .map(([qId, answer]) => {
              const question = session.intent_spec.blocking_questions.find(q => q.id === qId);
              return question ? `${question.question} → ${hardenInput(answer)}` : `${qId}: ${hardenInput(answer)}`;
            })
            .join('\n');
          enrichedPrompt += `\n\nAdditional context from user:\n${answerText}`;
        }
        if (edits) {
          enrichedPrompt += `\n\n${hardenInput(edits)}`;
        }

        const outputTarget: OutputTarget = target || session.target;

        // Re-analyze
        const answeredIds = new Set(Object.keys(session.answers));
        const intentSpec = analyzePrompt(enrichedPrompt, session.context, answeredIds);
        const qualityBefore = scorePrompt(intentSpec, session.context);
        const { prompt: compiledPrompt, changes } = compilePrompt(intentSpec, session.context, outputTarget);
        const checklist = generateChecklist(compiledPrompt);
        const costEstimate = estimateCost(
          compiledPrompt + (session.context || ''),
          intentSpec.task_type,
          intentSpec.risk_level,
          outputTarget,
        );

        const state = intentSpec.blocking_questions.length > 0 ? 'ANALYZING' : 'COMPILED';

        await updateSession(storage, session_id, {
          intent_spec: intentSpec,
          compiled_prompt: compiledPrompt,
          quality_before: qualityBefore,
          compilation_checklist: checklist,
          cost_estimate: costEstimate,
          target: outputTarget,
          state,
        });

        const preview: PreviewPack = {
          request_id: requestId,
          session_id,
          state,
          intent_spec: intentSpec,
          quality_before: qualityBefore,
          compiled_prompt: compiledPrompt,
          compilation_checklist: checklist,
          blocking_questions: intentSpec.blocking_questions,
          assumptions: intentSpec.assumptions,
          cost_estimate: costEstimate,
          model_recommendation: costEstimate.recommended_model,
          changes_made: changes,
          target: outputTarget,
          format_version: 1,
          scoring_version: 2,
          ...(storageHealth === 'degraded' && { storage_health: 'degraded' }),
        };

        // I3: Metering-after-success
        let success = false;
        try {
          success = true;
        } finally {
          if (success) {
            await storage.incrementUsage();
            await storage.updateStats({
              type: 'optimize',
              score_before: qualityBefore.total,
              task_type: intentSpec.task_type,
              blocking_questions: intentSpec.blocking_questions.map(q => q.question),
            });
          }
        }

        log.info(requestId, `refine_prompt: session=${session_id}, score=${qualityBefore.total}`);
        return jsonResponse(preview);
      } catch (err) {
        log.error(requestId, 'refine_prompt failed:', err instanceof Error ? err.message : String(err));
        return errorResponse({
          request_id: requestId,
          error: 'internal_error',
          message: `refine_prompt failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        });
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════════════════
  // Tool 3: approve_prompt (FREE)
  // ══════════════════════════════════════════════════════════════════════════════

  server.tool(
    'approve_prompt',
    'Approve the compiled prompt. Returns the final optimized prompt ready for use.',
    {
      session_id: z.string().regex(/^[a-zA-Z0-9-]+$/).describe('Session ID from optimize_prompt'),
    },
    async ({ session_id }) => {
      const ctx = await buildCtx();
      const { requestId } = ctx;

      try {
        const session = await getSession(storage, session_id);
        if (!session) {
          return errorResponse({
            request_id: requestId,
            error: 'session_not_found',
            message: 'Session not found or expired.',
          });
        }

        if (session.intent_spec.blocking_questions.length > 0) {
          return errorResponse({
            request_id: requestId,
            error: 'blocking_questions_remain',
            message: `Cannot approve: ${session.intent_spec.blocking_questions.length} blocking question(s) remain. Use refine_prompt first.`,
          });
        }

        await updateSession(storage, session_id, { state: 'APPROVED' });

        await storage.updateStats({ type: 'approve' });

        log.info(requestId, `approve_prompt: session=${session_id}`);
        return jsonResponse({
          request_id: requestId,
          status: 'APPROVED',
          compiled_prompt: session.compiled_prompt,
          quality_score_before: session.quality_before.total,
          cost_estimate: session.cost_estimate,
          model_recommendation: session.cost_estimate.recommended_model,
          recommendation_reason: session.cost_estimate.recommendation_reason,
        });
      } catch (err) {
        log.error(requestId, 'approve_prompt failed:', err instanceof Error ? err.message : String(err));
        return errorResponse({
          request_id: requestId,
          error: 'internal_error',
          message: `approve_prompt failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        });
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════════════════
  // Tool 4: estimate_cost (FREE)
  // ══════════════════════════════════════════════════════════════════════════════

  server.tool(
    'estimate_cost',
    'Estimate token count and cost across providers for any prompt text. No session needed.',
    {
      prompt_text: z.string().min(1).max(102400).describe('The prompt text to estimate cost for'),
      target: z.enum(['claude', 'openai', 'generic']).default('claude').describe('Target platform for model recommendations'),
    },
    async ({ prompt_text, target }) => {
      const ctx = await buildCtx();
      const { requestId } = ctx;

      try {
        prompt_text = hardenInput(prompt_text);
        const outputTarget: OutputTarget = target || ctx.config.default_target;
        const estimate = estimateCostForText(prompt_text, outputTarget);

        log.info(requestId, `estimate_cost: tokens=${estimate.input_tokens}`);
        return jsonResponse({
          request_id: requestId,
          ...estimate,
        });
      } catch (err) {
        log.error(requestId, 'estimate_cost failed:', err instanceof Error ? err.message : String(err));
        return errorResponse({
          request_id: requestId,
          error: 'internal_error',
          message: `estimate_cost failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        });
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════════════════
  // Tool 5: compress_context (FREE)
  // ══════════════════════════════════════════════════════════════════════════════

  server.tool(
    'compress_context',
    'Compress context (code, docs) by removing irrelevant sections. Returns pruned context with token savings.',
    {
      context: z.string().min(1).max(102400).describe('The context text to compress'),
      intent: z.string().min(1).describe('What the task is about — used to determine relevance'),
    },
    async ({ context, intent }) => {
      const ctx = await buildCtx();
      const { requestId } = ctx;

      try {
        context = hardenInput(context);
        intent = hardenInput(intent);
        const result = compressContext(context, intent);

        log.info(requestId, `compress_context: ${result.originalTokens} → ${result.compressedTokens} tokens`);
        return jsonResponse({
          request_id: requestId,
          compressed_context: result.compressed,
          removed_sections: result.removed,
          original_tokens: result.originalTokens,
          compressed_tokens: result.compressedTokens,
          tokens_saved: result.originalTokens - result.compressedTokens,
          savings_percent: result.originalTokens > 0
            ? Math.round(((result.originalTokens - result.compressedTokens) / result.originalTokens) * 100)
            : 0,
        });
      } catch (err) {
        log.error(requestId, 'compress_context failed:', err instanceof Error ? err.message : String(err));
        return errorResponse({
          request_id: requestId,
          error: 'internal_error',
          message: `compress_context failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        });
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════════════════
  // Tool 6: check_prompt (FREE)
  // ══════════════════════════════════════════════════════════════════════════════

  server.tool(
    'check_prompt',
    'Quick pass/fail check of a prompt. Returns score, top issues, and a suggestion. No compilation, no session.',
    {
      raw_prompt: z.string().min(1).max(102400).describe('The prompt to check'),
      context: z.string().max(102400).optional().describe('Optional context'),
    },
    async ({ raw_prompt, context }) => {
      const ctx = await buildCtx();
      const { requestId } = ctx;

      try {
        raw_prompt = hardenInput(raw_prompt);
        if (context) context = hardenInput(context);

        const taskType = detectTaskType(raw_prompt);
        const intentSpec = analyzePrompt(raw_prompt, context);
        const score = scorePrompt(intentSpec, context);

        // Threshold from config or strictness map
        const threshold = ctx.config.threshold || STRICTNESS_THRESHOLDS[ctx.config.strictness] || 60;
        const pass = score.total >= threshold;

        // Top 2 issues from rules (sorted deterministically: severity desc, rule asc)
        const ruleResults = runRules(raw_prompt, context, taskType);
        const sorted = sortIssues(ruleResults);
        const topIssues = sorted.slice(0, 2).map(r => ({
          rule: r.rule_name,
          severity: r.severity,
          message: r.message,
        }));

        const suggestion = pass
          ? 'Prompt meets quality threshold. Consider using optimize_prompt for further improvements.'
          : 'Prompt is below quality threshold. Use optimize_prompt to improve it.';

        log.info(requestId, `check_prompt: score=${score.total}, pass=${pass}, task=${taskType}`);
        return jsonResponse({
          request_id: requestId,
          score: score.total,
          max: score.max,
          pass,
          threshold,
          task_type: taskType,
          top_issues: topIssues,
          blocking_questions_count: intentSpec.blocking_questions.length,
          suggestion,
        });
      } catch (err) {
        log.error(requestId, 'check_prompt failed:', err instanceof Error ? err.message : String(err));
        return errorResponse({
          request_id: requestId,
          error: 'internal_error',
          message: `check_prompt failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        });
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════════════════
  // Tool 7: configure_optimizer (FREE)
  // ══════════════════════════════════════════════════════════════════════════════

  server.tool(
    'configure_optimizer',
    'Configure optimizer behavior: mode, threshold, strictness, default target, ephemeral mode, session limits.',
    {
      mode: z.enum(['manual', 'always_on']).optional().describe('Optimization mode'),
      threshold: z.number().min(0).max(100).optional().describe('Quality threshold (0-100)'),
      strictness: z.enum(['relaxed', 'standard', 'strict']).optional().describe('Strictness level'),
      auto_compile: z.boolean().optional().describe('Auto-compile prompts'),
      default_target: z.enum(['claude', 'openai', 'generic']).optional().describe('Default output target'),
      ephemeral_mode: z.boolean().optional().describe('Ephemeral mode: sessions in-memory only'),
      max_sessions: z.number().min(1).max(10000).optional().describe('Max session count'),
      max_session_size_kb: z.number().min(1).max(1024).optional().describe('Max session size in KB'),
      max_session_dir_mb: z.number().min(1).max(100).optional().describe('Max session directory size in MB'),
    },
    async (params) => {
      const ctx = await buildCtx();
      const { requestId } = ctx;

      try {
        // always_on tier check
        if (params.mode === 'always_on' && !PLAN_LIMITS[ctx.tier]?.always_on) {
          return errorResponse({
            request_id: requestId,
            error: 'tier_feature_unavailable',
            message: 'always_on mode requires Pro tier.',
            upgrade_hint: true,
          });
        }

        // Build partial config from provided params
        const updates: Partial<OptimizerConfig> = {};
        const appliedChanges: string[] = [];

        if (params.mode !== undefined) { updates.mode = params.mode; appliedChanges.push(`mode → ${params.mode}`); }
        if (params.threshold !== undefined) { updates.threshold = params.threshold; appliedChanges.push(`threshold → ${params.threshold}`); }
        if (params.strictness !== undefined) { updates.strictness = params.strictness; appliedChanges.push(`strictness → ${params.strictness}`); }
        if (params.auto_compile !== undefined) { updates.auto_compile = params.auto_compile; appliedChanges.push(`auto_compile → ${params.auto_compile}`); }
        if (params.default_target !== undefined) { updates.default_target = params.default_target; appliedChanges.push(`default_target → ${params.default_target}`); }
        if (params.ephemeral_mode !== undefined) { updates.ephemeral_mode = params.ephemeral_mode; appliedChanges.push(`ephemeral_mode → ${params.ephemeral_mode}`); }
        if (params.max_sessions !== undefined) { updates.max_sessions = params.max_sessions; appliedChanges.push(`max_sessions → ${params.max_sessions}`); }
        if (params.max_session_size_kb !== undefined) { updates.max_session_size_kb = params.max_session_size_kb; appliedChanges.push(`max_session_size_kb → ${params.max_session_size_kb}`); }
        if (params.max_session_dir_mb !== undefined) { updates.max_session_dir_mb = params.max_session_dir_mb; appliedChanges.push(`max_session_dir_mb → ${params.max_session_dir_mb}`); }

        const config = await storage.setConfig(updates);

        log.info(requestId, `configure_optimizer: ${appliedChanges.join(', ')}`);
        return jsonResponse({
          request_id: requestId,
          config,
          applied_changes: appliedChanges,
        });
      } catch (err) {
        log.error(requestId, 'configure_optimizer failed:', err instanceof Error ? err.message : String(err));
        return errorResponse({
          request_id: requestId,
          error: 'internal_error',
          message: `configure_optimizer failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        });
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════════════════
  // Tool 8: get_usage (FREE)
  // ══════════════════════════════════════════════════════════════════════════════

  server.tool(
    'get_usage',
    'Get current usage count, limits, remaining quota, and tier information.',
    {},
    async () => {
      const ctx = await buildCtx();
      const { requestId } = ctx;

      try {
        const usage = await storage.getUsage();
        const limits = PLAN_LIMITS[usage.tier] || PLAN_LIMITS.free;
        const remaining = {
          lifetime: Math.max(0, limits.lifetime - usage.total_optimizations),
          monthly: Math.max(0, limits.monthly - usage.total_optimizations), // Phase A: same as lifetime
        };

        log.info(requestId, `get_usage: total=${usage.total_optimizations}, tier=${usage.tier}`);
        return jsonResponse({
          request_id: requestId,
          total_optimizations: usage.total_optimizations,
          limits,
          remaining,
          tier: usage.tier,
          enforcement: null,
          first_used_at: usage.first_used_at,
          last_used_at: usage.last_used_at,
        });
      } catch (err) {
        log.error(requestId, 'get_usage failed:', err instanceof Error ? err.message : String(err));
        return errorResponse({
          request_id: requestId,
          error: 'internal_error',
          message: `get_usage failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        });
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════════════════
  // Tool 9: prompt_stats (FREE)
  // ══════════════════════════════════════════════════════════════════════════════

  server.tool(
    'prompt_stats',
    'Get aggregated optimization statistics: total count, average score, top task types, estimated savings.',
    {
      period: z.enum(['7d', '30d', 'lifetime']).default('lifetime').describe('Stats period (Phase A: lifetime only)'),
    },
    async ({ period }) => {
      const ctx = await buildCtx();
      const { requestId } = ctx;

      try {
        const stats = await storage.getStats();
        const usage = await storage.getUsage();

        // Deterministic ordering (I1)
        const topTaskTypes = sortCountsDescKeyAsc(stats.task_type_counts, 5);
        const topBlockingQuestions = sortCountsDescKeyAsc(stats.blocking_question_counts, 5);

        const avgScore = stats.total_optimized > 0
          ? Math.round(stats.score_sum_before / stats.total_optimized)
          : 0;

        log.info(requestId, `prompt_stats: total=${stats.total_optimized}, period=${period}`);
        return jsonResponse({
          request_id: requestId,
          total_optimized: stats.total_optimized,
          total_approved: stats.total_approved,
          avg_quality_score_before: avgScore,
          top_task_types: topTaskTypes,
          top_blocking_questions: topBlockingQuestions,
          estimated_cost_savings_usd: Math.round(stats.estimated_cost_savings_usd * 100) / 100,
          scoring_version: stats.scoring_version,
          tier: usage.tier,
          member_since: usage.first_used_at,
        });
      } catch (err) {
        log.error(requestId, 'prompt_stats failed:', err instanceof Error ? err.message : String(err));
        return errorResponse({
          request_id: requestId,
          error: 'internal_error',
          message: `prompt_stats failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        });
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════════════════
  // Tool 10: set_license (FREE)
  // ══════════════════════════════════════════════════════════════════════════════

  server.tool(
    'set_license',
    'Activate a Pro or Power license key. Validates the Ed25519 signature offline and unlocks the corresponding tier.',
    {
      license_key: z.string().min(10).max(2048).describe('License key string (starts with po_pro_)'),
    },
    async ({ license_key }) => {
      const ctx = await buildCtx();
      const { requestId } = ctx;

      try {
        const result = validateLicenseKey(license_key);

        if (!result.valid) {
          log.warn(requestId, `set_license: validation failed — ${result.error}`);
          return errorResponse({
            request_id: requestId,
            error: 'invalid_license',
            message: result.error === 'expired'
              ? 'License key has expired. Please renew your subscription.'
              : `License key is invalid: ${result.error}`,
            pro_purchase_url: PRO_PURCHASE_URL,
            power_purchase_url: POWER_PURCHASE_URL,
          });
        }

        const now = new Date().toISOString();
        const licenseData: LicenseData = {
          schema_version: 1,
          tier: result.payload.tier,
          issued_at: result.payload.issued_at,
          expires_at: result.payload.expires_at,
          license_id: result.payload.license_id,
          activated_at: now,
          valid: true,
        };

        await storage.setLicense(licenseData);

        log.info(requestId, `set_license: activated tier=${result.payload.tier}, license_id=${result.payload.license_id}`);
        return jsonResponse({
          request_id: requestId,
          status: 'activated',
          tier: result.payload.tier,
          expires_at: result.payload.expires_at,
          license_id: result.payload.license_id,
          limits: PLAN_LIMITS[result.payload.tier] || PLAN_LIMITS.free,
        });
      } catch (err) {
        log.error(requestId, 'set_license failed:', err instanceof Error ? err.message : String(err));
        return errorResponse({
          request_id: requestId,
          error: 'internal_error',
          message: `set_license failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        });
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════════════════
  // Tool 11: license_status (FREE)
  // ══════════════════════════════════════════════════════════════════════════════

  server.tool(
    'license_status',
    'Check current license status, tier, and expiry. Returns purchase link if no license is active.',
    {},
    async () => {
      const ctx = await buildCtx();
      const { requestId } = ctx;

      try {
        const license = await storage.getLicense();

        if (!license) {
          log.info(requestId, 'license_status: no license');
          return jsonResponse({
            request_id: requestId,
            has_license: false,
            tier: 'free',
            limits: PLAN_LIMITS.free,
            pro_purchase_url: PRO_PURCHASE_URL,
            power_purchase_url: POWER_PURCHASE_URL,
          });
        }

        const limits = PLAN_LIMITS[license.tier] || PLAN_LIMITS.free;

        log.info(requestId, `license_status: tier=${license.tier}, valid=${license.valid}, id=${license.license_id}`);
        return jsonResponse({
          request_id: requestId,
          has_license: true,
          valid: license.valid,
          tier: license.tier,
          license_id: license.license_id,
          expires_at: license.expires_at,
          activated_at: license.activated_at,
          limits,
          ...(license.validation_error && { validation_error: license.validation_error }),
          ...(!license.valid && { pro_purchase_url: PRO_PURCHASE_URL, power_purchase_url: POWER_PURCHASE_URL }),
        });
      } catch (err) {
        log.error(requestId, 'license_status failed:', err instanceof Error ? err.message : String(err));
        return errorResponse({
          request_id: requestId,
          error: 'internal_error',
          message: `license_status failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        });
      }
    },
  );
}
