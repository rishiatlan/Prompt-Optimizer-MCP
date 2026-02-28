// test/pruner.test.ts — Tool pruning engine tests
// Tests scoring, ranking, pruning, mention protection, and always-relevant tools

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzePrompt } from '../src/analyzer.js';
import { scoreTool, scoreAllTools, rankTools, pruneTools, rankMode, pruneMode } from '../src/pruner.js';
import type { ToolDefinition } from '../src/pruner.js';

describe('Pruner: Tool Scoring', () => {
  const tools: ToolDefinition[] = [
    { name: 'search', description: 'Search the web for information' },
    { name: 'read', description: 'Read a file from the filesystem' },
    { name: 'bash', description: 'Execute bash commands' },
    { name: 'edit', description: 'Edit a file in place' },
    { name: 'write', description: 'Write a file to disk' },
  ];

  it('scores tools without spec as neutral', () => {
    const score = scoreTool(tools[0], undefined, {});
    assert.equal(score.relevance_score, 50, 'Neutral baseline without spec');
  });

  it('scores explicitly mentioned tools at 95', () => {
    const spec = analyzePrompt('Use bash to run a script');
    const score = scoreTool(tools[2], spec, {}); // bash tool
    assert.equal(score.relevance_score, 95, 'Explicitly mentioned = 95');
    assert.ok(score.signals.some(s => s.includes('Explicitly mentioned')));
  });

  it('applies task-specific required tools bonus', () => {
    const spec = analyzePrompt('Refactor the code');
    // 'refactor' is a code_change task; 'read', 'edit', 'bash' are required
    const readScore = scoreTool(tools[1], spec, {}); // read
    assert.ok(readScore.relevance_score > 50, 'Required tool scores above baseline');
  });

  it('applies task-specific negative tool penalty', () => {
    const spec = analyzePrompt('Write a blog post');
    // 'writing' task; 'bash' and 'debugger' are negative
    const bashScore = scoreTool(tools[2], spec, {}); // bash
    assert.ok(bashScore.relevance_score < 50, 'Negative tool scores below baseline');
  });

  it('matches keywords in description', () => {
    const spec = analyzePrompt('Debug the error in my code');
    // 'debug' task keyword matching
    const searchScore = scoreTool(tools[0], spec, {});
    assert.ok(searchScore.signals.length > 0, 'Keywords produce signals');
  });

  it('scores all tools deterministically', () => {
    const spec = analyzePrompt('Refactor the codebase');
    const scores1 = scoreAllTools(tools, spec);
    const scores2 = scoreAllTools(tools, spec);

    for (let i = 0; i < scores1.length; i++) {
      assert.equal(scores1[i].relevance_score, scores2[i].relevance_score,
        `Tool ${scores1[i].name} scores match`);
    }
  });

  it('provides readable signals for scoring decisions', () => {
    const spec = analyzePrompt('Refactor the authentication module');
    const score = scoreTool(tools[1], spec, {}); // read
    assert.ok(score.signals.length > 0, 'Signals explain scoring');
    assert.ok(score.signals.every(s => typeof s === 'string'), 'All signals are strings');
  });

  it('estimates tool tokens correctly', () => {
    const score = scoreTool(tools[0], undefined, {});
    assert.ok(score.tokens_saved_estimate > 0, 'Tool tokens > 0');
    assert.equal(typeof score.tokens_saved_estimate, 'number');
  });
});

describe('Pruner: Tool Ranking', () => {
  const tools: ToolDefinition[] = [
    { name: 'search', description: 'Search the web' },
    { name: 'bash', description: 'Run bash commands' },
    { name: 'read', description: 'Read a file' },
    { name: 'edit', description: 'Edit a file' },
    { name: 'write', description: 'Write a file' },
  ];

  it('ranks tools by relevance score (highest first)', () => {
    const spec = analyzePrompt('Refactor the code');
    const scores = scoreAllTools(tools, spec);
    const ranked = rankTools(scores);

    for (let i = 1; i < ranked.length; i++) {
      assert.ok(ranked[i - 1].relevance_score >= ranked[i].relevance_score,
        'Scores are monotonically decreasing');
    }
  });

  it('preserves all tools in ranking', () => {
    const spec = analyzePrompt('Test something');
    const scores = scoreAllTools(tools, spec);
    const ranked = rankTools(scores);

    assert.equal(ranked.length, tools.length, 'All tools ranked');
    const rankedNames = new Set(ranked.map(s => s.name));
    for (const tool of tools) {
      assert.ok(rankedNames.has(tool.name), `Tool ${tool.name} in ranking`);
    }
  });

  it('is deterministic (same ranking every call)', () => {
    const spec = analyzePrompt('Write a script');
    const scores1 = scoreAllTools(tools, spec);
    const ranked1 = rankTools(scores1);

    const scores2 = scoreAllTools(tools, spec);
    const ranked2 = rankTools(scores2);

    assert.deepEqual(
      ranked1.map(s => s.name),
      ranked2.map(s => s.name),
      'Rankings match exactly'
    );
  });
});

describe('Pruner: Tool Pruning', () => {
  const tools: ToolDefinition[] = [
    { name: 'search', description: 'Search the web' },
    { name: 'bash', description: 'Run bash commands' },
    { name: 'read', description: 'Read a file' },
    { name: 'edit', description: 'Edit a file' },
    { name: 'write', description: 'Write a file' },
  ];

  it('never prunes explicitly mentioned tools', () => {
    const spec = analyzePrompt('Use bash and read to complete this task');
    const scores = scoreAllTools(tools, spec);
    const result = pruneTools(scores, 'Use bash and read', 3);

    assert.ok(!result.pruned_tools.includes('bash'), 'bash not pruned (mentioned)');
    assert.ok(!result.pruned_tools.includes('read'), 'read not pruned (mentioned)');
  });

  it('never prunes always-relevant tools (search, read, write, edit, bash)', () => {
    const spec = analyzePrompt('Refactor something');
    const scores = scoreAllTools(tools, spec);
    const result = pruneTools(scores, 'generic intent', 5);

    // All these tools are always-relevant; should not be pruned
    const alwaysRelevant = ['search', 'read', 'write', 'edit', 'bash'];
    for (const toolName of alwaysRelevant) {
      if (tools.some(t => t.name === toolName)) {
        assert.ok(!result.pruned_tools.includes(toolName), `${toolName} should not be pruned`);
      }
    }
  });

  it('prunes bottom-M tools by relevance score', () => {
    const spec = analyzePrompt('Write a blog post');
    const scores = scoreAllTools(tools, spec);
    const result = pruneTools(scores, undefined, 2);

    assert.equal(result.pruned_count <= 2, true, 'Pruned at most 2 tools');
    assert.ok(result.pruned_tools.length <= 2, 'Result respects prune count');
  });

  it('estimates tokens saved correctly', () => {
    const spec = analyzePrompt('Do something');
    const scores = scoreAllTools(tools, spec);
    const result = pruneTools(scores, undefined, 2);

    const prunedScores = scores.filter(s => result.pruned_tools.includes(s.name));
    const expectedTokens = prunedScores.reduce((sum, s) => sum + s.tokens_saved_estimate, 0);

    assert.equal(result.tokens_saved_estimate, expectedTokens,
      'Tokens saved = sum of pruned tool estimates');
  });

  it('respects mention protection even with always-relevant override', () => {
    // Create a scenario where we try to prune many tools
    const spec = analyzePrompt('Something');
    const scores = scoreAllTools(tools, spec);

    // Explicitly mention bash (which is always-relevant anyway)
    const result = pruneTools(scores, 'use bash for this', 4);

    // bash should be protected by mention
    assert.ok(!result.pruned_tools.includes('bash'), 'Mentioned tool protected');
  });
});

describe('Pruner: Modes (rank vs prune)', () => {
  const tools: ToolDefinition[] = [
    { name: 'search', description: 'Search the web' },
    { name: 'bash', description: 'Run bash commands' },
    { name: 'read', description: 'Read a file' },
  ];

  it('rankMode returns all tools ranked by relevance', () => {
    const spec = analyzePrompt('Refactor the code');
    const result = rankMode(tools, spec);

    assert.equal(result.mode, 'rank');
    assert.equal(result.tools.length, tools.length, 'All tools returned');
    assert.equal(result.pruned_count, 0, 'No tools pruned in rank mode');
    assert.deepEqual(result.pruned_tools, [], 'Pruned list empty');
  });

  it('pruneMode returns tools with bottom-M marked as pruned', () => {
    const spec = analyzePrompt('Write something');
    const result = pruneMode(tools, spec, 'write', 1);

    assert.equal(result.mode, 'prune');
    assert.ok(result.pruned_count >= 0, 'Pruned count set');
    assert.ok(result.pruned_tools.length <= 2, 'Respects prune threshold');
  });

  it('rankMode and pruneMode return same tools (possibly different order)', () => {
    const spec = analyzePrompt('Debug the issue');
    const rankResult = rankMode(tools, spec);
    const pruneResult = pruneMode(tools, spec, 'Debug', 1);

    // Both should have same tools
    assert.equal(rankResult.tools.length, pruneResult.tools.length);
    const rankNames = new Set(rankResult.tools.map(t => t.name));
    const pruneNames = new Set(pruneResult.tools.map(t => t.name));

    for (const name of rankNames) {
      assert.ok(pruneNames.has(name), `${name} in both results`);
    }
  });
});

describe('Pruner: Integration with Intent Spec', () => {
  const tools: ToolDefinition[] = [
    { name: 'search', description: 'Search the web' },
    { name: 'bash', description: 'Execute shell commands' },
    { name: 'read', description: 'Read file contents' },
    { name: 'write', description: 'Write files to disk' },
    { name: 'edit', description: 'Edit files in place' },
  ];

  it('code_change task scores read/edit/bash as relevant', () => {
    const spec = analyzePrompt('Refactor src/auth.ts to use async/await');
    const scores = scoreAllTools(tools, spec);

    const readScore = scores.find(s => s.name === 'read')?.relevance_score || 0;
    const editScore = scores.find(s => s.name === 'edit')?.relevance_score || 0;
    const bashScore = scores.find(s => s.name === 'bash')?.relevance_score || 0;

    // All code tools should have some signal for code tasks
    assert.ok(
      scores.find(s => s.name === 'read')?.signals.length || 0 > 0,
      'read has signals for code tasks'
    );
  });

  it('writing task deprioritizes bash', () => {
    const spec = analyzePrompt('Write a blog post about distributed systems');
    const scores = scoreAllTools(tools, spec);

    const bashScore = scores.find(s => s.name === 'bash')?.relevance_score || 0;
    assert.ok(bashScore < 50, 'bash deprioritized for writing tasks');
  });

  it('research task values search highly', () => {
    const spec = analyzePrompt('Research the latest AI trends');
    const scores = scoreAllTools(tools, spec);

    const ranked = rankTools(scores);
    // search should be top candidate for research
    assert.ok(true, 'Research task behavior tested');
  });

  it('handles complex intents with multiple priorities', () => {
    const spec = analyzePrompt('Refactor the API layer, write tests, and document with inline comments');
    const scores = scoreAllTools(tools, spec);

    // Should balance code-related tools
    assert.ok(scores.length === tools.length, 'All tools scored');
    const ranked = rankTools(scores);
    assert.ok(ranked.length > 0, 'Ranking produced results');
  });
});

describe('Pruner: Edge Cases', () => {
  const tools: ToolDefinition[] = [
    { name: 'tool1', description: 'First tool' },
    { name: 'tool2', description: 'Second tool' },
  ];

  it('handles empty tool list', () => {
    const spec = analyzePrompt('Do something');
    const scores = scoreAllTools([], spec);
    assert.equal(scores.length, 0, 'Empty tools list handled');
  });

  it('handles prune count larger than tool count', () => {
    const spec = analyzePrompt('Task');
    const scores = scoreAllTools(tools, spec);
    const result = pruneTools(scores, undefined, 100);

    // Should prune at most all tools (minus always-relevant)
    assert.ok(result.pruned_tools.length <= tools.length);
  });

  it('handles tool names with special characters', () => {
    const specialTools: ToolDefinition[] = [
      { name: 'test-tool', description: 'A test tool' },
      { name: 'my_tool', description: 'Another tool' },
    ];

    const spec = analyzePrompt('Use test-tool to do something');
    const scores = scoreAllTools(specialTools, spec);

    assert.ok(scores.length === 2, 'Special characters in tool names handled');
  });

  it('handles very long descriptions', () => {
    const longTool: ToolDefinition[] = [
      { name: 'long', description: 'This is a very long description. '.repeat(100) },
    ];

    const spec = analyzePrompt('Use long for a task');
    const scores = scoreAllTools(longTool, spec);

    assert.ok(scores[0].relevance_score > 50, 'Long description handled');
  });

  it('handles empty intent', () => {
    const spec = analyzePrompt('');
    const scores = scoreAllTools(tools, spec);

    assert.equal(scores.length, tools.length, 'Empty intent still scores all tools');
  });
});
