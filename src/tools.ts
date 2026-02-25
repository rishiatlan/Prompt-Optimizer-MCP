// tools.ts — MCP tool registrations for the prompt optimizer.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { analyzePrompt } from './analyzer.js';
import { compilePrompt, compressContext } from './compiler.js';
import { scorePrompt, scoreCompiledPrompt } from './scorer.js';
import { estimateCost, estimateCostForText } from './estimator.js';
import { createSession, getSession, updateSession } from './session.js';
import type { PreviewPack, ModelTier } from './types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(data: unknown) {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(data, null, 2),
    }],
  };
}

function errorResponse(message: string) {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ error: message }, null, 2),
    }],
    isError: true,
  };
}

// ─── Tool Registrations ───────────────────────────────────────────────────────

export function registerTools(server: McpServer): void {

  // ── Tool 1: optimize_prompt ─────────────────────────────────────────────────

  server.tool(
    'optimize_prompt',
    'Analyze a raw prompt, detect ambiguities, compile an optimized XML-tagged version, score quality before/after, and estimate cost. Returns a PreviewPack for user review before execution.',
    {
      raw_prompt: z.string().min(1).describe('The raw user prompt to optimize'),
      context: z.string().optional().describe('Optional context: repo info, file contents, preferences'),
    },
    async ({ raw_prompt, context }) => {
      // 1. Analyze intent
      const intentSpec = analyzePrompt(raw_prompt, context);

      // 2. Score the raw prompt
      const qualityBefore = scorePrompt(intentSpec, context);

      // 3. Compile the optimized prompt
      const { prompt: compiledPrompt, changes } = compilePrompt(intentSpec, context);

      // 4. Score the compiled prompt
      const qualityAfter = scoreCompiledPrompt(compiledPrompt);

      // 5. Estimate cost
      const costEstimate = estimateCost(
        compiledPrompt + (context || ''),
        intentSpec.task_type,
        intentSpec.risk_level,
      );

      // 6. Create session
      const session = createSession({
        raw_prompt,
        context,
        intent_spec: intentSpec,
        compiled_prompt: compiledPrompt,
        quality_before: qualityBefore,
        quality_after: qualityAfter,
        cost_estimate: costEstimate,
      });

      // 7. Build PreviewPack
      const preview: PreviewPack = {
        session_id: session.id,
        state: intentSpec.blocking_questions.length > 0 ? 'ANALYZING' : 'COMPILED',
        intent_spec: intentSpec,
        quality_before: qualityBefore,
        compiled_prompt: compiledPrompt,
        quality_after: qualityAfter,
        blocking_questions: intentSpec.blocking_questions,
        assumptions: intentSpec.assumptions,
        cost_estimate: costEstimate,
        model_recommendation: costEstimate.recommended_model,
        changes_made: changes,
      };

      // Update session state
      updateSession(session.id, {
        state: preview.state,
      });

      return jsonResponse(preview);
    },
  );

  // ── Tool 2: refine_prompt ───────────────────────────────────────────────────

  server.tool(
    'refine_prompt',
    'Refine an optimized prompt by providing answers to blocking questions or manual edits. Re-runs analysis and returns updated PreviewPack.',
    {
      session_id: z.string().uuid().describe('Session ID from optimize_prompt'),
      answers: z.record(z.string(), z.string()).optional().describe('Answers to blocking questions: { question_id: answer }'),
      edits: z.string().optional().describe('Manual edits or additional context to incorporate'),
    },
    async ({ session_id, answers, edits }) => {
      const session = getSession(session_id);
      if (!session) return errorResponse('Session not found or expired.');

      // Merge answers
      if (answers) {
        Object.assign(session.answers, answers);
      }

      // Build enriched prompt from original + answers + edits
      let enrichedPrompt = session.raw_prompt;

      if (answers && Object.keys(answers).length > 0) {
        const answerText = Object.entries(answers)
          .map(([qId, answer]) => {
            const question = session.intent_spec.blocking_questions.find(q => q.id === qId);
            return question ? `${question.question} → ${answer}` : `${qId}: ${answer}`;
          })
          .join('\n');
        enrichedPrompt += `\n\nAdditional context from user:\n${answerText}`;
      }

      if (edits) {
        enrichedPrompt += `\n\n${edits}`;
      }

      // Re-analyze with enriched prompt — pass answered IDs so cleared questions aren't regenerated
      const answeredIds = new Set(Object.keys(session.answers));
      const intentSpec = analyzePrompt(enrichedPrompt, session.context, answeredIds);
      const qualityBefore = scorePrompt(intentSpec, session.context);
      const { prompt: compiledPrompt, changes } = compilePrompt(intentSpec, session.context);
      const qualityAfter = scoreCompiledPrompt(compiledPrompt);
      const costEstimate = estimateCost(
        compiledPrompt + (session.context || ''),
        intentSpec.task_type,
        intentSpec.risk_level,
      );

      // Update session
      updateSession(session_id, {
        intent_spec: intentSpec,
        compiled_prompt: compiledPrompt,
        quality_before: qualityBefore,
        quality_after: qualityAfter,
        cost_estimate: costEstimate,
        state: intentSpec.blocking_questions.length > 0 ? 'ANALYZING' : 'COMPILED',
      });

      const preview: PreviewPack = {
        session_id,
        state: intentSpec.blocking_questions.length > 0 ? 'ANALYZING' : 'COMPILED',
        intent_spec: intentSpec,
        quality_before: qualityBefore,
        compiled_prompt: compiledPrompt,
        quality_after: qualityAfter,
        blocking_questions: intentSpec.blocking_questions,
        assumptions: intentSpec.assumptions,
        cost_estimate: costEstimate,
        model_recommendation: costEstimate.recommended_model,
        changes_made: changes,
      };

      return jsonResponse(preview);
    },
  );

  // ── Tool 3: approve_prompt ──────────────────────────────────────────────────

  server.tool(
    'approve_prompt',
    'Approve the compiled prompt. Returns the final optimized prompt ready for use, along with cost estimate and model recommendation.',
    {
      session_id: z.string().uuid().describe('Session ID from optimize_prompt'),
    },
    async ({ session_id }) => {
      const session = getSession(session_id);
      if (!session) return errorResponse('Session not found or expired.');

      if (session.intent_spec.blocking_questions.length > 0) {
        return errorResponse(
          `Cannot approve: ${session.intent_spec.blocking_questions.length} blocking question(s) remain unanswered. Use refine_prompt to answer them first.`
        );
      }

      updateSession(session_id, { state: 'APPROVED' });

      return jsonResponse({
        status: 'APPROVED',
        compiled_prompt: session.compiled_prompt,
        quality_score: session.quality_after.total,
        quality_improvement: session.quality_after.total - session.quality_before.total,
        cost_estimate: session.cost_estimate,
        model_recommendation: session.cost_estimate.recommended_model,
        recommendation_reason: session.cost_estimate.recommendation_reason,
      });
    },
  );

  // ── Tool 4: estimate_cost ───────────────────────────────────────────────────

  server.tool(
    'estimate_cost',
    'Estimate token count and cost for any prompt text. Standalone tool — no session needed.',
    {
      prompt_text: z.string().min(1).describe('The prompt text to estimate cost for'),
      model: z.enum(['haiku', 'sonnet', 'opus']).optional().describe('Specific model to estimate for (or all if omitted)'),
    },
    async ({ prompt_text, model }) => {
      const estimate = estimateCostForText(prompt_text, model as ModelTier | undefined);
      return jsonResponse(estimate);
    },
  );

  // ── Tool 5: compress_context ────────────────────────────────────────────────

  server.tool(
    'compress_context',
    'Compress context (code, docs) by removing irrelevant sections. Returns pruned context with token savings report.',
    {
      context: z.string().min(1).describe('The context text to compress (code, documentation, etc.)'),
      intent: z.string().min(1).describe('What the task is about — used to determine relevance'),
    },
    async ({ context, intent }) => {
      const result = compressContext(context, intent);
      return jsonResponse({
        compressed_context: result.compressed,
        removed_sections: result.removed,
        original_tokens: result.originalTokens,
        compressed_tokens: result.compressedTokens,
        tokens_saved: result.originalTokens - result.compressedTokens,
        savings_percent: result.originalTokens > 0
          ? Math.round(((result.originalTokens - result.compressedTokens) / result.originalTokens) * 100)
          : 0,
      });
    },
  );
}
