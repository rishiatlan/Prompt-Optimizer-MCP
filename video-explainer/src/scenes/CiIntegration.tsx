import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  spring,
  useVideoConfig,
  Sequence,
} from 'remotion';
import {theme, FPS} from '../theme';
import {FadeIn, GlowText, ScaleIn} from '../components/AnimatedText';
import {CodeBlock} from '../components/Terminal';

export const CiIntegration: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{background: theme.bg}}>
      {/* Section title */}
      <Sequence from={0} durationInFrames={FPS * 8}>
        <AbsoluteFill style={{display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          <FadeIn delay={5}>
            <div style={{textAlign: 'center'}}>
              <div style={{fontSize: 28, color: theme.accentGreen, letterSpacing: 4, textTransform: 'uppercase', marginBottom: 20}}>
                Built for Teams
              </div>
              <div style={{fontSize: 64, fontWeight: 800, color: theme.white}}>
                CI / CD Integration
              </div>
              <div style={{fontSize: 24, color: theme.textMuted, marginTop: 20}}>
                Catch bad prompts in every pull request
              </div>
            </div>
          </FadeIn>
        </AbsoluteFill>
      </Sequence>

      {/* GitHub Action YAML */}
      <Sequence from={FPS * 7} durationInFrames={FPS * 25}>
        <AbsoluteFill style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60}}>
          <FadeIn delay={0}>
            <div style={{fontSize: 28, fontWeight: 700, color: theme.white, marginBottom: 24, textAlign: 'center'}}>
              GitHub Action — 5 Lines
            </div>
          </FadeIn>
          <FadeIn delay={FPS * 1}>
            <CodeBlock
              language=".github/workflows/prompt-lint.yml"
              code={`- uses: rishi-banerjee1/prompt-control-plane@v5.3.2
  with:
    files: 'prompts/**/*.txt'
    subcommand: preflight
    comment: 'true'`}
              highlightLines={[3, 4]}
              style={{width: 800}}
            />
          </FadeIn>
          <FadeIn delay={FPS * 6} style={{marginTop: 24}}>
            <div style={{display: 'flex', gap: 20, justifyContent: 'center'}}>
              <FeatureChip label="Auto PR Comments" icon="&#128172;" />
              <FeatureChip label="Step Summary" icon="&#128202;" />
              <FeatureChip label="Exit Codes" icon="&#9989;" />
            </div>
          </FadeIn>
          <FadeIn delay={FPS * 10} style={{marginTop: 30}}>
            <div style={{width: 800}}>
              <div style={{fontSize: 14, color: theme.textDim, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 2, textAlign: 'center'}}>
                PR Comment (auto-generated)
              </div>
              <PrComment />
            </div>
          </FadeIn>
        </AbsoluteFill>
      </Sequence>

      {/* Validate API */}
      <Sequence from={FPS * 32} durationInFrames={FPS * 28}>
        <AbsoluteFill style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60}}>
          <FadeIn delay={0}>
            <div style={{textAlign: 'center', marginBottom: 8}}>
              <div style={{fontSize: 18, color: theme.primary, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 12}}>
                For Developers
              </div>
              <div style={{fontSize: 40, fontWeight: 700, color: theme.white, marginBottom: 24}}>
                Lightweight Validate API
              </div>
            </div>
          </FadeIn>
          <FadeIn delay={FPS * 2}>
            <CodeBlock
              language="typescript"
              code={`import { validate } from 'pcp-engine/validate';

const result = validate(userPrompt, {
  threshold: 60,
  strictness: 'standard'
});

if (!result.pass) {
  // Block low-quality prompts
  return res.status(422).json({
    error: 'Prompt quality too low',
    score: result.score,
    issues: result.issues
  });
}`}
              highlightLines={[0, 2, 7]}
              style={{width: 800}}
            />
          </FadeIn>
          <FadeIn delay={FPS * 8} style={{marginTop: 24}}>
            <div style={{display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap'}}>
              {[
                'Zero MCP dependency',
                'Any Node.js backend',
                'LangChain & OpenAI SDK',
                'Same engine as CLI',
              ].map((item, i) => (
                <div key={i} style={{
                  background: `${theme.accent}12`,
                  border: `1px solid ${theme.accent}33`,
                  borderRadius: 10,
                  padding: '10px 20px',
                  fontSize: 16,
                  color: theme.accent,
                  fontWeight: 600,
                }}>
                  {item}
                </div>
              ))}
            </div>
          </FadeIn>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};

const PrComment: React.FC = () => (
  <div style={{
    background: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 12,
    overflow: 'hidden',
  }}>
    <div style={{
      background: '#161b22',
      padding: '12px 20px',
      borderBottom: '1px solid #30363d',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
    }}>
      <div style={{width: 32, height: 32, borderRadius: '50%', background: theme.primary, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <span style={{fontSize: 16, color: theme.white}}>P</span>
      </div>
      <span style={{color: '#c9d1d9', fontSize: 14, fontWeight: 600}}>pcp-bot</span>
      <span style={{color: '#8b949e', fontSize: 13}}>commented just now</span>
    </div>
    <div style={{padding: '20px 24px'}}>
      <div style={{fontSize: 20, fontWeight: 700, color: '#c9d1d9', marginBottom: 16}}>
        Prompt Control Plane
      </div>
      {/* Table */}
      <div style={{fontFamily: "'JetBrains Mono', monospace", fontSize: 14}}>
        <div style={{display: 'flex', borderBottom: '1px solid #30363d', padding: '8px 0', color: '#8b949e'}}>
          <span style={{flex: 2}}>File</span>
          <span style={{flex: 1}}>Score</span>
          <span style={{flex: 1}}>Status</span>
          <span style={{flex: 1.5}}>Top Issue</span>
        </div>
        <div style={{display: 'flex', padding: '8px 0', color: '#c9d1d9'}}>
          <span style={{flex: 2, color: '#79c0ff'}}>prompts/system.txt</span>
          <span style={{flex: 1}}>75/100</span>
          <span style={{flex: 1, color: '#3fb950'}}>PASS</span>
          <span style={{flex: 1.5, color: '#8b949e'}}>—</span>
        </div>
        <div style={{display: 'flex', padding: '8px 0', color: '#c9d1d9'}}>
          <span style={{flex: 2, color: '#79c0ff'}}>prompts/user.txt</span>
          <span style={{flex: 1}}>42/100</span>
          <span style={{flex: 1, color: '#f85149'}}>FAIL</span>
          <span style={{flex: 1.5, color: '#d29922'}}>vague_objective</span>
        </div>
      </div>
      <div style={{marginTop: 16, fontSize: 14, color: '#c9d1d9'}}>
        <strong>Summary:</strong> 1 passed, 1 failed (threshold: 60)
      </div>
    </div>
  </div>
);

const FeatureChip: React.FC<{label: string; icon: string}> = ({label, icon}) => (
  <div style={{
    background: theme.bgCard,
    border: `1px solid ${theme.border}`,
    borderRadius: 10,
    padding: '10px 18px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 16,
    color: theme.text,
  }}>
    <span>{icon}</span> {label}
  </div>
);
