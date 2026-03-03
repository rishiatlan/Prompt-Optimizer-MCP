// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Prompt Control Plane — Canvas Explainer  v4
// 30 fps × 9000 frames = 300 seconds = 5 minutes
//
// Pacing rules:
//   • 2-2.5 chars/sec typewriter for demo prompts
//   • Every major reveal holds 3+ seconds before next element
//   • Narrator bar stays visible for the full scene mid-section
//   • Scene chapters: 0 Intro, 1 Problem, 2 Solution, 3 Pipeline,
//     4 Bad Prompt, 5 Good Prompt, 6 Cost Routing, 7 Enterprise,
//     8 Summary, 9 CTA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
(function () {
  const FPS          = 30;
  const W            = 1080, H = 580;
  const NAR_Y        = 500;
  const TOTAL_FRAMES = 9000; // 300 s = 5 min

  // ── Palette ──────────────────────────────────────────────────────────
  const C = {
    bg: '#07080f', surface: '#0f1117', surface2: '#161924', surface3: '#1e2233',
    border: '#242840', border2: '#2e3352',
    primary: '#4d7cfe', cyan: '#38d9e8', green: '#34d399',
    red: '#f87171', orange: '#fb923c', purple: '#a78bfa',
    yellow: '#fbbf24', text: '#e4e7f5', muted: '#6b7280', dim: '#3d4260',
  };

  // ── Math helpers ──────────────────────────────────────────────────────
  const lerp   = (a,b,t) => a+(b-a)*Math.max(0,Math.min(1,t));
  const clamp  = (v,a,b) => Math.max(a,Math.min(b,v));
  const eio    = t => { t=clamp(t,0,1); return t<0.5?2*t*t:-1+(4-2*t)*t; };
  const eout   = t => { t=clamp(t,0,1); return 1-(1-t)*(1-t); };
  const ein    = t => { t=clamp(t,0,1); return t*t; };
  const spring = t => { t=clamp(t,0,1); return 1-Math.cos(t*Math.PI*3.5)*Math.exp(-t*6); };

  const p          = (f,s,d) => clamp((f-s)/d,0,1);
  const fi         = (f,s,d) => eout(p(f,s,d));
  const fo         = (f,s,d) => 1-eout(p(f,s,d));
  const fi_spring  = (f,s,d) => spring(p(f,s,d));

  // Typewriter helper: cps = chars per second
  const tw = (text,f,s,cps=2.5) =>
    text.slice(0, Math.max(0, Math.floor((f-s)*cps/FPS)));

  // ── Draw primitives ───────────────────────────────────────────────────
  function rr(ctx,x,y,w,h,r=8) { ctx.beginPath(); ctx.roundRect(x,y,w,h,r); }

  function box(ctx,x,y,w,h,{fill,stroke,lw=1,r=8,alpha=1}={}) {
    ctx.save(); ctx.globalAlpha=alpha;
    rr(ctx,x,y,w,h,r);
    if(fill){ctx.fillStyle=fill;ctx.fill();}
    if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lw;ctx.stroke();}
    ctx.restore();
  }

  function txt(ctx,text,x,y,{color=C.text,size=14,align='left',alpha=1,bold=false,mono=false,italic=false}={}) {
    if(!text)return;
    ctx.save();
    ctx.globalAlpha=alpha;
    ctx.fillStyle=color;
    const sty=italic?'italic ':'', wt=bold?'700':'400';
    const fam=mono?"'JetBrains Mono','Courier New',monospace":"'Inter',system-ui,sans-serif";
    ctx.font=`${sty}${wt} ${size}px ${fam}`;
    ctx.textAlign=align; ctx.textBaseline='middle';
    ctx.fillText(text,x,y);
    ctx.restore();
  }

  function wtxt(ctx,text,x,y,maxW,lineH,opts={}) {
    const words=text.split(' '); let line='',cy=y;
    for(const w of words){
      const test=line+w+' ';
      ctx.save();
      ctx.font=`${opts.bold?'700':'400'} ${opts.size||14}px ${opts.mono?"'JetBrains Mono',monospace":"'Inter',system-ui,sans-serif"}`;
      const mw=ctx.measureText(test).width;
      ctx.restore();
      if(mw>maxW&&line!==''){txt(ctx,line.trim(),x,cy,opts);line=w+' ';cy+=lineH;}
      else{line=test;}
    }
    txt(ctx,line.trim(),x,cy,opts);
    return cy;
  }

  function bar(ctx,x,y,w,h,pct,color,bg=C.surface2,r=4) {
    box(ctx,x,y,w,h,{fill:bg,r});
    if(pct>0.005)box(ctx,x,y,w*clamp(pct,0,1),h,{fill:color,r});
  }

  function arrow(ctx,x1,y1,x2,y2,color=C.primary,lw=2,alpha=1,hs=9) {
    ctx.save(); ctx.globalAlpha=alpha;
    const angle=Math.atan2(y2-y1,x2-x1);
    ctx.strokeStyle=color; ctx.fillStyle=color; ctx.lineWidth=lw;
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2,y2);
    ctx.lineTo(x2-hs*Math.cos(angle-0.4),y2-hs*Math.sin(angle-0.4));
    ctx.lineTo(x2-hs*Math.cos(angle+0.4),y2-hs*Math.sin(angle+0.4));
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function dline(ctx,x1,y1,x2,y2,{color=C.border,lw=1,alpha=1,dash=[]}={}) {
    ctx.save(); ctx.globalAlpha=alpha;
    ctx.strokeStyle=color; ctx.lineWidth=lw; ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    ctx.restore();
  }

  function pill(ctx,cx,cy,label,color,alpha=1) {
    ctx.save(); ctx.globalAlpha=alpha;
    ctx.font="600 11px 'Inter',system-ui,sans-serif";
    const tw2=ctx.measureText(label).width+22;
    rr(ctx,cx-tw2/2,cy-12,tw2,24,12);
    ctx.fillStyle=color+'22'; ctx.fill();
    ctx.strokeStyle=color+'66'; ctx.lineWidth=1; ctx.stroke();
    ctx.fillStyle=color; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(label,cx,cy);
    ctx.restore();
  }

  // Radial score gauge
  function gauge(ctx,cx,cy,r,val,color,alpha=1) {
    ctx.save(); ctx.globalAlpha=alpha;
    const s=-Math.PI*0.75, e=s+Math.PI*1.5*(val/100);
    ctx.beginPath(); ctx.arc(cx,cy,r,s,s+Math.PI*1.5);
    ctx.strokeStyle=C.surface3; ctx.lineWidth=10; ctx.lineCap='round'; ctx.stroke();
    if(val>0){ctx.beginPath();ctx.arc(cx,cy,r,s,e);ctx.strokeStyle=color;ctx.lineWidth=10;ctx.stroke();}
    ctx.fillStyle=C.text; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.font=`800 ${Math.floor(r*0.52)}px 'Inter',system-ui,sans-serif`;
    ctx.fillText(Math.round(val),cx,cy-6);
    ctx.fillStyle=C.muted; ctx.font=`400 ${Math.floor(r*0.22)}px 'Inter',system-ui,sans-serif`;
    ctx.fillText('/100',cx,cy+18);
    ctx.restore();
  }

  // Terminal chrome
  function terminal(ctx,x,y,w,h,title,alpha) {
    box(ctx,x,y,w,h,{fill:C.surface,stroke:C.border,r:12,alpha});
    ctx.save(); ctx.globalAlpha=alpha;
    rr(ctx,x,y,w,36,[12,12,0,0]); ctx.fillStyle=C.surface2; ctx.fill();
    ctx.fillStyle='#f87171'; ctx.beginPath(); ctx.arc(x+25,y+18,5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#fbbf24'; ctx.beginPath(); ctx.arc(x+42,y+18,5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#34d399'; ctx.beginPath(); ctx.arc(x+59,y+18,5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=C.muted; ctx.font="400 11px 'Inter',system-ui,sans-serif";
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(title,x+w/2,y+18);
    ctx.restore();
  }

  // Chapter dots + label
  function drawChapter(ctx,sceneIdx,total,label,f,ss,alpha=1) {
    const sp=14, tw2=(total-1)*sp, dx=W/2-tw2/2;
    for(let i=0;i<total;i++){
      const act=i===sceneIdx;
      ctx.save(); ctx.globalAlpha=alpha*(act?1:0.22);
      ctx.fillStyle=act?C.primary:C.muted;
      ctx.beginPath(); ctx.arc(dx+i*sp,H-18,act?4:2.5,0,Math.PI*2); ctx.fill();
      ctx.restore();
    }
    txt(ctx,label.toUpperCase(),32,26,{size:10,color:C.dim,bold:true,alpha:fi(f,ss,24)*alpha});
  }

  // Narrator bar
  function narrator(ctx,lines,f,showAt,duration,alpha=1) {
    const a=fi(f,showAt,22)*fo(f,showAt+duration,22)*alpha;
    if(a<0.01)return;
    ctx.save(); ctx.globalAlpha=a*0.30;
    ctx.strokeStyle=C.border2; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(60,NAR_Y); ctx.lineTo(W-60,NAR_Y); ctx.stroke();
    ctx.restore();
    lines.forEach((l,i)=>{
      const la=fi(f,showAt+i*12,20)*fo(f,showAt+duration,22)*alpha;
      txt(ctx,l,W/2,NAR_Y+22+i*24,{size:i===0?13.5:12,color:i===0?C.text:C.muted,align:'center',alpha:la});
    });
  }

  // Background: subtle grid + vignette
  function drawBg(ctx) {
    ctx.fillStyle=C.bg; ctx.fillRect(0,0,W,H);
    ctx.save(); ctx.strokeStyle='rgba(255,255,255,0.018)'; ctx.lineWidth=1;
    for(let x=0;x<=W;x+=60){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
    for(let y=0;y<=H;y+=60){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
    ctx.restore();
    const vig=ctx.createRadialGradient(W/2,H/2,H*0.3,W/2,H/2,H*0.85);
    vig.addColorStop(0,'transparent'); vig.addColorStop(1,'rgba(0,0,0,0.5)');
    ctx.fillStyle=vig; ctx.fillRect(0,0,W,H);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SCENE TIMELINE  (9000 frames = 300 seconds = 5 min)
  //
  //  0  Intro          0    → 450   (15 s)
  //  1  The Problem    450  → 1350  (30 s)
  //  2  The Solution   1350 → 1950  (20 s)
  //  3  How It Works   1950 → 3150  (40 s)
  //  4  Bad Prompt     3150 → 4350  (40 s)
  //  5  Good Prompt    4350 → 5550  (40 s)
  //  6  Cost Routing   5550 → 6450  (30 s)
  //  7  Enterprise     6450 → 7650  (40 s)
  //  8  Summary        7650 → 8700  (35 s)
  //  9  CTA            8700 → 9000  (10 s)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const scenes = [

    // ─── 0 · INTRO  (0–450 = 15 s) ────────────────────────────────────
    {
      start:0, end:450, title:'Intro',
      draw(ctx,lf,lt) {
        const ao=lf>lt-35?fo(lf,lt-35,35):1;

        // Radial glow behind logo
        ctx.save();
        const glowA=fi(lf,0,60)*ao*0.55;
        const glow=ctx.createRadialGradient(W/2,H/2-80,0,W/2,H/2-80,220);
        glow.addColorStop(0,`rgba(77,124,254,${glowA})`);
        glow.addColorStop(0.5,`rgba(56,217,232,${glowA*0.4})`);
        glow.addColorStop(1,'transparent');
        ctx.fillStyle=glow; ctx.fillRect(0,0,W,H); ctx.restore();

        // Logo (spring entrance)
        const ls=fi_spring(lf,5,70)*ao;
        ctx.save(); ctx.translate(W/2,H/2-80); ctx.scale(ls,ls);
        rr(ctx,-40,-40,80,80,18);
        const lg=ctx.createLinearGradient(-40,-40,40,40);
        lg.addColorStop(0,'#4d7cfe'); lg.addColorStop(1,'#38d9e8');
        ctx.fillStyle=lg; ctx.fill();
        ctx.fillStyle='#fff'; ctx.font="800 27px 'JetBrains Mono',monospace";
        ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('PCP',0,1);
        ctx.restore();

        const a1=fi(lf,60,30)*ao, a2=fi(lf,90,30)*ao;
        const a3=fi(lf,120,30)*ao, a4=fi(lf,155,30)*ao;

        txt(ctx,'Prompt Control Plane',W/2,H/2-15,{size:40,bold:true,align:'center',alpha:a1});
        txt(ctx,'A governance layer for every AI prompt — explained in plain English.',W/2,H/2+30,
          {size:15,color:C.muted,align:'center',alpha:a2});

        // Duration + version badge row
        ctx.save(); ctx.globalAlpha=a3;
        rr(ctx,W/2-100,H/2+54,200,32,8); ctx.fillStyle=C.surface; ctx.fill();
        ctx.strokeStyle=C.border2; ctx.lineWidth=1; ctx.stroke(); ctx.restore();
        txt(ctx,'5 min walkthrough  ·  v4.0.3',W/2,H/2+70,{size:12,color:C.muted,align:'center',alpha:a3});

        // 4 chapter previews
        const bullets=[
          {icon:'🔍',text:'What PCP does and why it exists'},
          {icon:'📊',text:'Live demo: vague → compiled prompt (+42 pts)'},
          {icon:'💰',text:'Automatic cost routing — up to 94% savings'},
          {icon:'🔒',text:'Enterprise policy enforcement & audit trail'},
        ];
        bullets.forEach((b,i)=>{
          const ba=fi(lf,170+i*22,22)*ao;
          const bx=W/2-240, by=H/2+110+i*30;
          txt(ctx,b.icon,bx,by,{size:14,alpha:ba});
          txt(ctx,b.text,bx+30,by,{size:13,color:C.muted,alpha:ba});
        });

        narrator(ctx,
          ['Welcome to Prompt Control Plane — deterministic prompt governance with zero LLM calls.',
           'Watch how PCP checks, rewrites, costs, and routes every AI prompt automatically.'],
          lf,100,lt-100);
        drawChapter(ctx,0,10,'Intro',lf,0);
      }
    },

    // ─── 1 · THE PROBLEM  (450–1350 = 30 s) ───────────────────────────
    {
      start:450, end:1350, title:'The Problem',
      draw(ctx,lf,lt) {
        const ao=lf>lt-35?fo(lf,lt-35,35):1;

        txt(ctx,'The Problem',W/2,46,{size:11,color:C.muted,align:'center',bold:true,alpha:fi(lf,0,22)*ao});
        txt(ctx,'AI prompts run blind today',W/2,86,{size:32,bold:true,align:'center',alpha:fi(lf,12,28)*ao});
        txt(ctx,'No quality check. No cost preview. No governance. Just hope.',W/2,116,
          {size:15,color:C.muted,align:'center',alpha:fi(lf,28,28)*ao});

        const cards=[
          {icon:'💸',color:C.orange,title:'No idea what it will cost',
           desc:'You only find out token cost after the model responds. By then it\'s too late to optimize. A simple factual question shouldn\'t cost the same as a complex refactor.',
           stat:'up to 94× overpaying'},
          {icon:'🌫️',color:C.red,title:'"Make the code better" — better how?',
           desc:'Vague prompts produce unpredictable results. The model guesses your intent and is often wrong — wasting a call and requiring you to re-prompt multiple times.',
           stat:'avg 2-3 re-prompts'},
          {icon:'🎲',color:C.purple,title:'Most expensive model for everything',
           desc:'A simple "What is REST?" gets sent to GPT-4o or Claude Opus. Gemini Flash answers it correctly for 1/50th the price. Nobody routes automatically.',
           stat:'$0.022 vs $0.00022'},
          {icon:'🚫',color:C.cyan,title:'No audit trail for your team',
           desc:'Anyone can prompt anything. There\'s no policy, no review step, and no record of what prompts were sent, what risk level they carried, or why decisions were made.',
           stat:'zero governance'},
        ];

        cards.forEach((card,i)=>{
          const appear=45+i*195; // each card ~6.5 s apart
          const a=fi(lf,appear,30)*ao;
          const slideY=lerp(18,0,eout(p(lf,appear,30)));
          const col=i%2, row=Math.floor(i/2);
          const bx=68+col*510, by=158+row*152+slideY;
          const bw=462, bh=132;
          const textCX=bx+64+(bw-64)/2;

          box(ctx,bx,by,bw,bh,{fill:C.surface,stroke:card.color+'44',lw:1.5,r:12,alpha:a});
          ctx.save(); ctx.globalAlpha=a*0.8;
          rr(ctx,bx,by,4,bh,[12,0,0,12]); ctx.fillStyle=card.color; ctx.fill(); ctx.restore();

          txt(ctx,card.icon,bx+28,by+44,{size:26,alpha:a});
          // Title centered in text area
          txt(ctx,card.title,textCX,by+28,{size:13.5,bold:true,color:C.text,align:'center',alpha:a});
          wtxt(ctx,card.desc,bx+64,by+50,370,18,{size:11.5,color:C.muted,alpha:a});

          // Stat badge bottom-right
          const statA=fi(lf,appear+40,22)*ao;
          pill(ctx,bx+bw-60,by+bh-16,card.stat,card.color,statA);
        });

        narrator(ctx,
          ['Every day, teams overpay, get bad results, and have zero oversight of their AI usage.',
           'PCP fixes all four problems automatically — in under 1 second, with no model calls.'],
          lf,100,lt-100);
        drawChapter(ctx,1,10,'The Problem',lf,0);
      }
    },

    // ─── 2 · THE SOLUTION  (1350–1950 = 20 s) ─────────────────────────
    {
      start:1350, end:1950, title:'The Solution',
      draw(ctx,lf,lt) {
        const ao=lf>lt-35?fo(lf,lt-35,35):1;

        txt(ctx,'The Solution',W/2,46,{size:11,color:C.muted,align:'center',bold:true,alpha:fi(lf,0,22)*ao});
        txt(ctx,'PCP intercepts before the model',W/2,86,{size:32,bold:true,align:'center',alpha:fi(lf,12,28)*ao});

        const fa=fi(lf,25,30)*ao;

        // User box (left)
        const ux=72,uy=158,uw=224,uh=128;
        box(ctx,ux,uy,uw,uh,{fill:C.surface2,stroke:C.border2,r:12,alpha:fa});
        txt(ctx,'👤',ux+22,uy+48,{size:28,alpha:fa});
        txt(ctx,'You',ux+uw/2+10,uy+32,{size:17,bold:true,align:'center',alpha:fa});
        txt(ctx,'type a prompt…',ux+uw/2+10,uy+54,{size:12,color:C.muted,align:'center',alpha:fa});
        txt(ctx,'"make the code better"',ux+uw/2+10,uy+78,{size:11,color:C.yellow,mono:true,align:'center',alpha:fa});
        txt(ctx,'vague · costly · unrouted',ux+uw/2+10,uy+100,{size:10,color:C.red,align:'center',alpha:fa});

        // PCP center box (pulsing)
        const pcpA=fi(lf,55,30)*ao;
        const pulse=Math.sin(lf*0.10)*0.06+0.94;
        ctx.save(); ctx.globalAlpha=pcpA*0.10*pulse;
        rr(ctx,366,144,298,156,18); ctx.fillStyle=C.primary; ctx.fill(); ctx.restore();
        box(ctx,369,147,292,150,{fill:C.surface,stroke:C.primary,lw:2,r:16,alpha:pcpA});
        txt(ctx,'🛡️',W/2+8,176,{size:30,align:'center',alpha:pcpA});
        txt(ctx,'Prompt Control Plane',W/2+8,206,{size:15,bold:true,align:'center',color:C.primary,alpha:pcpA});
        txt(ctx,'Check  ·  Rewrite  ·  Route',W/2+8,228,{size:12,align:'center',color:C.muted,alpha:pcpA});
        txt(ctx,'< 1 second  ·  Zero LLM calls  ·  Deterministic',W/2+8,250,{size:11,align:'center',color:C.dim,alpha:pcpA});
        txt(ctx,'100% offline  ·  Free tier available',W/2+8,270,{size:10.5,align:'center',color:C.dim,alpha:pcpA});

        // AI box (right)
        const aiA=fi(lf,80,28)*ao;
        const ax=756,ay=158,aw=252,ah=128;
        box(ctx,ax,ay,aw,ah,{fill:C.surface2,stroke:C.green+'55',r:12,alpha:aiA});
        txt(ctx,'🤖',ax+22,ay+48,{size:28,alpha:aiA});
        txt(ctx,'The AI Model',ax+aw/2+10,ay+32,{size:15,bold:true,align:'center',alpha:aiA});
        txt(ctx,'Right model for the task',ax+aw/2+10,ay+54,{size:12,color:C.green,align:'center',alpha:aiA});
        txt(ctx,'At the lowest possible cost',ax+aw/2+10,ay+74,{size:11,color:C.muted,align:'center',alpha:aiA});
        txt(ctx,'With full context',ax+aw/2+10,ay+94,{size:11,color:C.muted,align:'center',alpha:aiA});

        // Arrows
        const arA=fi(lf,90,24)*ao;
        arrow(ctx,296,222,364,222,C.muted,2,arA);
        arrow(ctx,661,222,752,222,C.green,2.5,arA);
        txt(ctx,'raw prompt',296,212,{size:10,color:C.orange,alpha:arA});
        txt(ctx,'structured + routed',661,212,{size:10,color:C.green,alpha:arA});

        // 4 clarifications (staggered, centered under each quadrant)
        const cl=[
          {icon:'✓',text:'Clarity & completeness check'},
          {icon:'✓',text:'Structured rewrite (XML/JSON)'},
          {icon:'✓',text:'Cheapest capable model picked'},
          {icon:'✓',text:'Decision logged to audit trail'},
        ];
        cl.forEach((c,i)=>{
          const ca=fi(lf,145+i*22,20)*ao;
          const cx2=78+i*236;
          txt(ctx,c.icon,cx2,385,{size:14,color:C.green,alpha:ca});
          txt(ctx,c.text,cx2+22,385,{size:12,color:C.muted,alpha:ca});
        });

        narrator(ctx,
          ['PCP sits between your cursor and the AI model — invisible, automatic, always on.',
           'Your prompt goes in vague. It comes out structured, priced, and routed correctly.'],
          lf,110,lt-110);
        drawChapter(ctx,2,10,'The Solution',lf,0);
      }
    },

    // ─── 3 · HOW IT WORKS  (1950–3150 = 40 s = 1200 frames) ──────────
    {
      start:1950, end:3150, title:'How It Works',
      draw(ctx,lf,lt) {
        const ao=lf>lt-35?fo(lf,lt-35,35):1;

        txt(ctx,'Inside PCP',W/2,46,{size:11,color:C.muted,align:'center',bold:true,alpha:fi(lf,0,22)*ao});
        txt(ctx,'5 things PCP does for every prompt',W/2,86,{size:28,bold:true,align:'center',alpha:fi(lf,12,28)*ao});

        const steps=[
          {num:'1',color:C.cyan,
           title:'Is the prompt clear enough?',
           body:'PCP runs 14 built-in ambiguity rules looking for vague verbs ("improve", "fix it"), missing targets, and undefined success criteria. If anything is unclear, it generates a targeted blocking question — and won\'t move on until you answer it.',
           tag:'analyzer.ts  ·  rules.ts'},
          {num:'2',color:C.green,
           title:'Rewrite it with full structure',
           body:'PCP compiles the clarified prompt into a structured format: role → goal → success criteria → constraints → step-by-step workflow. Claude gets XML, OpenAI gets system+user JSON, or you can use generic Markdown. The model now has everything it needs.',
           tag:'compiler.ts'},
          {num:'3',color:C.orange,
           title:'How much will this cost?',
           body:'Before a single API call is made, PCP estimates input + output tokens and shows you the price across all 11 supported models — Claude, GPT-4o, Gemini Flash, Perplexity and more. You see cost before you commit.',
           tag:'estimator.ts'},
          {num:'4',color:C.purple,
           title:'Which model is the right fit?',
           body:'A "What is REST?" question doesn\'t need Opus. PCP classifies prompt complexity (simple_factual → agent_orchestration) and risk (0-100), then routes to the cheapest model that can handle the task correctly. Up to 94% cheaper per call.',
           tag:'estimator.ts  ·  router.ts'},
          {num:'5',color:C.primary,
           title:'Log every decision permanently',
           body:'Every optimize, approve, delete, and block event writes to a tamper-evident JSONL audit log using SHA-256 hash chaining. Risk score, session ID, policy outcome, timestamp — your compliance team can review everything, any time.',
           tag:'auditLog.ts'},
        ];

        // Each step appears 215 frames (7.2 s) apart
        steps.forEach((s,i)=>{
          const appear=30+i*220;
          const a=fi(lf,appear,28)*ao;
          const slideX=lerp(-24,0,eout(p(lf,appear,28)));
          const y=140+i*62+(i>0?i*3:0);
          const rowH=56;

          // Active step has brighter ring + glow
          const doneByNow=lf>=appear+28;
          const isCurrent=i===Math.min(4,Math.floor(lf/220));
          const ringAlpha=isCurrent?1:doneByNow?0.5:0;

          if(a>0.04){
            ctx.save(); ctx.globalAlpha=a*(isCurrent?0.06:0.025);
            rr(ctx,60+slideX,y-4,W-120,rowH,10);
            ctx.fillStyle=s.color; ctx.fill(); ctx.restore();
            box(ctx,60+slideX,y-4,W-120,rowH,{stroke:s.color+(isCurrent?'99':'33'),lw:isCurrent?1.5:1,r:10,alpha:a});
          }

          // Numbered circle
          ctx.save(); ctx.globalAlpha=a;
          ctx.fillStyle=s.color+'30'; ctx.strokeStyle=s.color+(isCurrent?'cc':'60'); ctx.lineWidth=isCurrent?2:1.5;
          ctx.beginPath(); ctx.arc(96+slideX,y+24,20,0,Math.PI*2); ctx.fill(); ctx.stroke();
          ctx.restore();
          txt(ctx,s.num,96+slideX,y+24,{size:14,bold:true,color:s.color,align:'center',alpha:a});

          txt(ctx,s.tag,W-125+slideX,y+16,{size:9.5,color:C.dim,mono:true,align:'right',alpha:a});
          // Title centered in row
          txt(ctx,s.title,570+slideX,y+16,{size:15,bold:true,color:C.text,align:'center',alpha:a});
          wtxt(ctx,s.body,128+slideX,y+35,820,17,{size:11.5,color:C.muted,alpha:a});
        });

        // Pipeline connector (vertical dashed line down left side)
        const connA=fi(lf,30,20)*ao;
        if(connA>0.05){
          ctx.save(); ctx.globalAlpha=connA*0.35;
          ctx.strokeStyle=C.border2; ctx.lineWidth=1.5; ctx.setLineDash([4,4]);
          ctx.beginPath(); ctx.moveTo(96,160); ctx.lineTo(96,445); ctx.stroke();
          ctx.restore();
        }

        narrator(ctx,
          ['These 5 steps run in sequence for every call to optimize_prompt.',
           'All deterministic — same prompt in, same analysis out, every single time.'],
          lf,100,lt-100);
        drawChapter(ctx,3,10,'How It Works',lf,0);
      }
    },

    // ─── 4 · VAGUE PROMPT DEMO  (3150–4350 = 40 s = 1200 frames) ─────
    {
      start:3150, end:4350, title:'Bad Prompt',
      draw(ctx,lf,lt) {
        const ao=lf>lt-35?fo(lf,lt-35,35):1;

        txt(ctx,'Demo — Vague Prompt',W/2,46,{size:11,color:C.muted,align:'center',bold:true,alpha:fi(lf,0,22)*ao});
        txt(ctx,'What PCP catches before the model ever sees it',W/2,86,
          {size:26,bold:true,align:'center',alpha:fi(lf,12,28)*ao});

        const ta=fi(lf,18,24)*ao;
        terminal(ctx,60,114,960,348,'optimize_prompt — live',ta);

        // ── Left panel ──────────────────────────────────────
        // "YOU TYPE:" centered in left half (x=60–540, center=300)
        txt(ctx,'YOU TYPE:',300,170,{size:10,color:C.dim,bold:true,mono:true,align:'center',alpha:ta});

        // Prompt types at 2 chars/sec: 20 chars → 10 s = 300 frames
        const rawPrompt='make the code better';
        const typed=tw(rawPrompt,lf,24,2);
        const fullDone=typed.length>=rawPrompt.length;
        const cursorBlink=!fullDone||Math.floor(lf/14)%2===0;

        // Centered in left half
        txt(ctx,'> ',106,205,{size:20,color:C.muted,mono:true,alpha:ta});
        txt(ctx,typed+(cursorBlink?'▋':''),134,205,{size:20,color:C.yellow,mono:true,alpha:ta});

        // Word highlights after typing completes (~frame 324)
        const hlA=fi(lf,330,25)*ao;
        if(hlA>0.01&&fullDone){
          ctx.save(); ctx.font="400 20px 'JetBrains Mono',monospace";
          const pre=ctx.measureText('> make the ').width;
          const codeW=ctx.measureText('code').width;
          const betterPre=ctx.measureText('> make the code ').width;
          const betterW=ctx.measureText('better').width;
          // "code" highlight
          ctx.globalAlpha=hlA*0.28; ctx.fillStyle=C.orange;
          ctx.fillRect(106+pre-8,194,codeW+10,24); ctx.restore();
          ctx.save(); ctx.globalAlpha=hlA*0.28; ctx.fillStyle=C.red; ctx.font="400 20px 'JetBrains Mono',monospace";
          ctx.fillRect(106+betterPre-8,194,betterW+10,24); ctx.restore();
          // Labels
          txt(ctx,'↑ which code?',106+pre+codeW/2,184,{size:9.5,color:C.orange,mono:true,align:'center',alpha:hlA});
          txt(ctx,'↑ better how?',106+betterPre+betterW/2,184,{size:9.5,color:C.red,mono:true,align:'center',alpha:hlA});
        }

        // Rules fired (appear at ~frame 360)
        const rfA=fi(lf,365,22)*ao;
        txt(ctx,'RULES FIRED:',82,240,{size:9.5,color:C.dim,bold:true,mono:true,alpha:rfA});
        const rules=[
          {c:C.orange,t:'vague_objective  (no measurable goal)'},
          {c:C.red,t:'missing_target  (no file / scope specified)'},
          {c:C.muted,t:'scope_explosion  (risk: medium)'},
        ];
        rules.forEach((r,i)=>txt(ctx,'⚑  '+r.t,82,257+i*18,{size:10.5,color:r.c,mono:true,alpha:fi(lf,365+i*20,20)*ao}));

        // ── Right panel ─────────────────────────────────────
        dline(ctx,540,150,540,452,{color:C.border,alpha:ta});
        // "PCP RESPONSE:" centered in right half (x=540–1020, center=780)
        txt(ctx,'PCP RESPONSE:',780,170,{size:10,color:C.dim,bold:true,mono:true,align:'center',alpha:ta});

        const results=[
          {c:C.red,   t:'⛔  Status:  ANALYZING',  big:true},
          {c:C.orange,t:'Score:   48 / 100',        big:false},
          {c:C.muted, t:'Task:    code_change',     big:false},
          {c:C.muted, t:'',                          big:false},
          {c:C.red,   t:'Blocking Questions:',       big:false},
          {c:C.text,  t:'❓  "Which file or function?"',big:false},
          {c:C.text,  t:'❓  "What metric? Speed? Memory?"',big:false},
          {c:C.muted, t:'',                          big:false},
          {c:C.orange,t:'⚠  Cannot compile.',        big:false},
        ];
        // Results start appearing after typing + hold (~frame 340)
        results.forEach((r,i)=>{
          const ra=fi(lf,340+i*25,22)*ao;
          txt(ctx,r.t,780,204+i*25,{size:r.big?16:12.5,color:r.c,mono:true,align:'center',alpha:ra,bold:r.big});
        });

        // Score gauge (left panel, below prompt)
        const ga=fi(lf,355,25)*ao;
        const sv=ga>0?48*eout(p(lf,355,40)):0;
        gauge(ctx,220,360,58,sv*ga,C.orange,ga);
        txt(ctx,'Quality score',220,430,{size:11,color:C.muted,align:'center',alpha:ga});
        txt(ctx,'Before PCP',220,444,{size:10,color:C.dim,align:'center',alpha:ga});

        // Risk bar
        const ria=fi(lf,372,22)*ao;
        txt(ctx,'RISK LEVEL',82,392,{size:9.5,color:C.dim,mono:true,alpha:ria});
        bar(ctx,82,404,180,10,p(lf,372,40)*0.52,C.orange,C.surface2,5);
        txt(ctx,'medium  (52 / 100)',82,422,{size:11,color:C.orange,mono:true,alpha:ria});

        // Bottom callout (frame ~760)
        const ba=fi(lf,760,25)*ao;
        box(ctx,60,458,960,40,{fill:C.red+'12',stroke:C.red+'30',r:8,alpha:ba});
        txt(ctx,'→  PCP stops here. Your prompt cannot reach the model until the two questions above are answered.',
          W/2,479,{size:13,color:C.text,align:'center',alpha:ba});

        narrator(ctx,
          ['"make the code better" scores 48/100 — two vague words trigger two blocking questions.',
           'PCP won\'t compile. The model won\'t guess. You answer the questions, then it compiles.'],
          lf,90,lt-90);
        drawChapter(ctx,4,10,'Bad Prompt',lf,0);
      }
    },

    // ─── 5 · GOOD PROMPT  (4350–5550 = 40 s = 1200 frames) ───────────
    {
      start:4350, end:5550, title:'Good Prompt',
      draw(ctx,lf,lt) {
        const ao=lf>lt-35?fo(lf,lt-35,35):1;

        txt(ctx,'Demo — After Answering',W/2,46,{size:11,color:C.muted,align:'center',bold:true,alpha:fi(lf,0,22)*ao});
        txt(ctx,'The same intent — after you clarify with PCP',W/2,86,
          {size:26,bold:true,align:'center',alpha:fi(lf,12,28)*ao});

        const ta=fi(lf,15,24)*ao;
        terminal(ctx,60,114,960,348,'refine_prompt — answers provided',ta);

        // Left panel — centered header
        txt(ctx,'YOUR REFINED PROMPT:',300,170,{size:10,color:C.dim,bold:true,mono:true,align:'center',alpha:ta});

        // 4 prompt lines, centered at x=300, each delayed
        const pLines=[
          {t:'Refactor  src/auth/middleware.ts',c:C.text,ann:'← specific target file',ac:C.cyan},
          {t:'to reduce P99 latency below 100ms.',c:C.text,ann:'← measurable success metric',ac:C.green},
          {t:'Do not touch the database layer.',c:C.text,ann:'← hard constraint',ac:C.orange},
          {t:'All existing tests must still pass.',c:C.text,ann:'← acceptance criteria',ac:C.purple},
        ];
        pLines.forEach((l,i)=>{
          const la=fi(lf,22+i*22,20)*ao;
          txt(ctx,l.t,300,202+i*28,{size:14,color:l.c,mono:true,align:'center',alpha:la});
        });
        // Annotations appear together after all lines
        const annA=fi(lf,125,25)*ao;
        pLines.forEach((l,i)=>{
          txt(ctx,l.ann,492,202+i*28,{size:9.5,color:l.ac,italic:true,alpha:annA});
        });

        // Right panel
        dline(ctx,540,150,540,452,{color:C.border,alpha:ta});
        txt(ctx,'PCP RESPONSE:',780,170,{size:10,color:C.dim,bold:true,mono:true,align:'center',alpha:ta});

        const r2=[
          {c:C.green, t:'✓  Status:  COMPILED',             big:true},
          {c:C.green, t:'Score:  90 / 100  (+42 pts)',       big:false},
          {c:C.cyan,  t:'Task:   refactor',                  big:false},
          {c:C.red,   t:'Risk:   high  (auth domain)',        big:false},
          {c:C.purple,t:'Model:  claude-opus-4  ← routed',   big:false},
          {c:C.muted, t:'',                                   big:false},
          {c:C.green, t:'Target: src/auth/middleware.ts  ✓', big:false},
          {c:C.green, t:'Constraints: 2 preserved  ✓',       big:false},
          {c:C.green, t:'Format: XML (Claude-optimized)  ✓', big:false},
        ];
        r2.forEach((r,i)=>{
          const ra=fi(lf,108+i*22,20)*ao;
          txt(ctx,r.t,780,204+i*25,{size:r.big?16:12.5,color:r.c,mono:true,align:'center',alpha:ra,bold:r.big});
        });

        // Gauges: before / after
        const ga=fi(lf,118,24)*ao;
        gauge(ctx,155,358,52,48*ga,C.orange,ga);
        txt(ctx,'Before',155,422,{size:11,color:C.muted,align:'center',alpha:ga});

        const arA=fi(lf,135,22)*ao;
        arrow(ctx,218,358,270,358,C.green,2.5,arA);

        const scoreAfter=ga>0?lerp(48,90,eio(p(lf,126,60))):0;
        gauge(ctx,314,358,52,scoreAfter*ga,C.green,ga);
        txt(ctx,'After',314,422,{size:11,color:C.green,align:'center',alpha:ga});

        // +42 badge
        const da=fi(lf,186,22)*ao;
        ctx.save(); ctx.globalAlpha=da;
        rr(ctx,198,428,80,28,8); ctx.fillStyle=C.green+'20'; ctx.fill();
        ctx.strokeStyle=C.green+'60'; ctx.lineWidth=1.5; ctx.stroke(); ctx.restore();
        txt(ctx,'+42 pts',238,443,{size:13,bold:true,color:C.green,align:'center',alpha:da});

        // Bottom callout
        const ba=fi(lf,500,25)*ao;
        box(ctx,60,458,960,40,{fill:C.green+'10',stroke:C.green+'30',r:8,alpha:ba});
        txt(ctx,'→  A specific, constrained prompt scores 90/100 and compiles immediately. The model gets a full structured spec.',
          W/2,479,{size:13,color:C.text,align:'center',alpha:ba});

        // XML preview (frame ~680)
        const xmlA=fi(lf,680,25)*ao;
        if(xmlA>0.01){
          box(ctx,60,310,470,136,{fill:C.surface2,stroke:C.border2,r:8,alpha:xmlA});
          txt(ctx,'COMPILED OUTPUT (XML):',100,326,{size:9.5,color:C.dim,bold:true,mono:true,alpha:xmlA});
          const xmlLines=['<prompt>','  <role>Senior TypeScript engineer</role>',
            '  <goal>Reduce P99 latency below 100ms</goal>',
            '  <constraint>No DB layer changes</constraint>','</prompt>'];
          xmlLines.forEach((l,i)=>txt(ctx,l,72,342+i*18,{size:10.5,color:i===0||i===4?C.primary:C.muted,mono:true,alpha:xmlA}));
        }

        narrator(ctx,
          ['After answering two questions, the same prompt scores 90/100 and compiles to XML.',
           'PCP detected auth domain risk and routed to Opus — the right model for this task.'],
          lf,90,lt-90);
        drawChapter(ctx,5,10,'Good Prompt',lf,0);
      }
    },

    // ─── 6 · COST ROUTING  (5550–6450 = 30 s = 900 frames) ───────────
    {
      start:5550, end:6450, title:'Cost Routing',
      draw(ctx,lf,lt) {
        const ao=lf>lt-35?fo(lf,lt-35,35):1;

        txt(ctx,'Cost Routing',W/2,46,{size:11,color:C.muted,align:'center',bold:true,alpha:fi(lf,0,22)*ao});
        txt(ctx,'Right model for the job — not the most expensive',W/2,86,
          {size:26,bold:true,align:'center',alpha:fi(lf,12,28)*ao});

        // 2-step algorithm boxes (centered labels)
        const hdr=fi(lf,18,24)*ao;
        box(ctx,60,114,460,52,{fill:C.surface2,stroke:C.border2,r:8,alpha:hdr});
        txt(ctx,'STEP 1',60+230,130,{size:10,color:C.dim,bold:true,align:'center',alpha:hdr});
        txt(ctx,'Classify complexity + risk  →  tier  (small / mid / top)',
          60+230,150,{size:12,color:C.text,mono:true,align:'center',alpha:hdr});

        const hdr2=fi(lf,38,24)*ao;
        box(ctx,60,174,460,52,{fill:C.surface2,stroke:C.border2,r:8,alpha:hdr2});
        txt(ctx,'STEP 2',60+230,190,{size:10,color:C.dim,bold:true,align:'center',alpha:hdr2});
        txt(ctx,'Apply overrides  (budget?  quality_first?  risk ≥ 40?)',
          60+230,210,{size:12,color:C.text,mono:true,align:'center',alpha:hdr2});

        // Cost comparison bars (right side)
        const models=[
          {name:'Gemini 2.0 Flash', cost:0.00022,color:C.green,  tag:'94% cheaper · simple tasks'},
          {name:'GPT-3.5 Turbo',    cost:0.00115,color:C.cyan,   tag:'straightforward questions'},
          {name:'Perplexity',        cost:0.00650,color:C.muted,  tag:'web search tasks'},
          {name:'GPT-4o  ✓ rec.',   cost:0.00725,color:C.primary,tag:'best quality / cost balance'},
          {name:'Claude 3.5 Sonnet',cost:0.01350,color:C.purple, tag:'most capable'},
        ];
        const maxCost=0.0135;

        txt(ctx,'Cost per call  (500 input + 600 output tokens, analytical task)',
          552,120,{size:11,color:C.muted,alpha:fi(lf,14,20)*ao});

        models.forEach((m,i)=>{
          const appear=24+i*58;
          const ma=fi(lf,appear,28)*ao;
          const y=148+i*64;
          const isRec=m.name.includes('✓');
          if(isRec&&ma>0.05)box(ctx,547,y-10,480,56,{fill:C.primary+'0a',stroke:C.primary+'30',r:8,alpha:ma});
          txt(ctx,m.name,558,y+12,{size:13,color:isRec?C.primary:C.text,bold:isRec,alpha:ma});
          txt(ctx,m.tag,558,y+32,{size:10,color:C.muted,alpha:ma});
          const bw=252,bh=14;
          const fillW=p(lf,appear+6,42)*m.cost/maxCost;
          bar(ctx,558+198,y-3,bw,bh,fillW,m.color,C.surface2,4);
          txt(ctx,'$'+m.cost.toFixed(5),558+198+bw+10,y+5,{size:11,color:m.color,mono:true,alpha:ma});
        });

        // Override examples panel
        const ovA=fi(lf,380,25)*ao;
        box(ctx,60,244,460,160,{fill:C.surface,stroke:C.border2,r:10,alpha:ovA});
        txt(ctx,'OVERRIDE EXAMPLES',290,264,{size:10,color:C.dim,bold:true,mono:true,align:'center',alpha:ovA});
        const ovs=[
          {c:C.green,  t:'budget_sensitivity=high   →  downgrade 1 tier'},
          {c:C.green,  t:'latency_sensitivity=high  →  downgrade 1 tier'},
          {c:C.purple, t:'profile=quality_first     →  upgrade 1 tier'},
          {c:C.red,    t:'risk_score ≥ 40           →  force escalate to top'},
        ];
        ovs.forEach((o,i)=>{
          const oa=fi(lf,388+i*22,20)*ao;
          txt(ctx,'›  '+o.t,78,284+i*26,{size:11,color:o.c,mono:true,alpha:oa});
        });

        // Animated savings counter
        const sa=fi(lf,560,25)*ao;
        const savePct=Math.round(lerp(0,94,eout(p(lf,560,60))));
        box(ctx,60,456,960,34,{fill:C.green+'12',stroke:C.green+'35',r:10,alpha:sa});
        txt(ctx,`🎯  Routing to Gemini Flash for simple tasks saves up to ${savePct}% vs. Claude 3.5 Sonnet — automatically.`,
          W/2,474,{size:13,color:C.text,align:'center',alpha:sa});

        narrator(ctx,
          ['PCP classifies complexity + risk in one pass, then picks the cheapest model that can handle it.',
           'No configuration needed. No manual routing rules. Every call gets the right model.'],
          lf,90,lt-90);
        drawChapter(ctx,6,10,'Cost Routing',lf,0);
      }
    },

    // ─── 7 · ENTERPRISE  (6450–7650 = 40 s = 1200 frames) ────────────
    {
      start:6450, end:7650, title:'Enterprise',
      draw(ctx,lf,lt) {
        const ao=lf>lt-35?fo(lf,lt-35,35):1;

        txt(ctx,'Enterprise',W/2,46,{size:11,color:C.muted,align:'center',bold:true,alpha:fi(lf,0,22)*ao});
        txt(ctx,'Policy enforcement + governance for teams',W/2,86,
          {size:28,bold:true,align:'center',alpha:fi(lf,12,28)*ao});

        const pa=fi(lf,18,28)*ao;

        // ── Dangerous prompt box (centered text) ───────────
        const lx=60,ly=118,lw=476,lh=182;
        const lcx=lx+lw/2;
        box(ctx,lx,ly,lw,lh,{fill:C.surface,stroke:C.red+'55',lw:1.5,r:12,alpha:pa});
        ctx.save(); ctx.globalAlpha=pa*0.8;
        rr(ctx,lx,ly,4,lh,[12,0,0,12]); ctx.fillStyle=C.red; ctx.fill(); ctx.restore();
        txt(ctx,'A team member types:',lcx,ly+22,{size:11,color:C.muted,align:'center',alpha:pa});
        txt(ctx,'"Delete all inactive users',lcx,ly+54,{size:16,color:C.text,mono:true,align:'center',alpha:pa});
        txt(ctx,'  from the production database"',lcx,ly+76,{size:16,color:C.text,mono:true,align:'center',alpha:pa});
        txt(ctx,'Risk Score:  75 / 100',lcx,ly+112,{size:14,color:C.red,bold:true,mono:true,align:'center',alpha:pa});
        txt(ctx,'High risk  ·  No constraints  ·  No rollback plan',lcx,ly+134,{size:11,color:C.muted,align:'center',alpha:pa});
        txt(ctx,'Matches 3 custom org rules',lcx,ly+155,{size:11,color:C.orange,align:'center',alpha:pa});
        txt(ctx,'(prod_data + destructive + no_preserve)',lcx,ly+170,{size:10,color:C.dim,align:'center',alpha:pa});

        // ── Policy Gate (diamond shape via box + labels) ────
        const pga=fi(lf,62,28)*ao;
        arrow(ctx,536,205,598,205,C.muted,2,pga);
        const pgx=600,pgy=152,pgw=196,pgh=106;
        box(ctx,pgx,pgy,pgw,pgh,{fill:C.surface,stroke:C.purple,lw:2,r:10,alpha:pga});
        txt(ctx,'⚖️  Policy Gate',pgx+pgw/2,pgy+26,{size:13,bold:true,align:'center',color:C.purple,alpha:pga});
        txt(ctx,'mode: enforce',pgx+pgw/2,pgy+50,{size:11,align:'center',color:C.muted,mono:true,alpha:pga});
        txt(ctx,'threshold: 60',pgx+pgw/2,pgy+70,{size:11,align:'center',color:C.orange,mono:true,alpha:pga});
        txt(ctx,'score 75 > 60 → BLOCK',pgx+pgw/2,pgy+92,{size:11,align:'center',color:C.red,mono:true,alpha:pga});

        // ── BLOCKED box ────────────────────────────────────
        const bla=fi(lf,96,28)*ao;
        if(lf>=96&&lf<=136){
          const flashA=(1-p(lf,96,40))*0.55;
          ctx.save(); ctx.globalAlpha=flashA; ctx.fillStyle=C.red; ctx.fillRect(0,0,W,H); ctx.restore();
        }
        arrow(ctx,796,205,852,205,C.red,2.5,bla);
        const bx2=854,by2=152,bw2=212,bh2=106;
        box(ctx,bx2,by2,bw2,bh2,{fill:C.red+'18',stroke:C.red+'80',lw:2.5,r:10,alpha:bla});
        txt(ctx,'⛔  BLOCKED',bx2+bw2/2,by2+36,{size:22,bold:true,align:'center',color:C.red,alpha:bla});
        txt(ctx,'risk_threshold_exceeded',bx2+bw2/2,by2+62,{size:11,align:'center',color:C.red,mono:true,alpha:bla});
        txt(ctx,'policy_mode: enforce',bx2+bw2/2,by2+82,{size:11,align:'center',color:C.muted,mono:true,alpha:bla});

        // ── Audit Log ──────────────────────────────────────
        const aa=fi(lf,140,28)*ao;
        box(ctx,60,312,980,152,{fill:C.surface,stroke:C.border,r:12,alpha:aa});
        txt(ctx,'TAMPER-EVIDENT AUDIT LOG  —  SHA-256 Hash Chaining',W/2,332,
          {size:11,color:C.green,bold:true,mono:true,align:'center',alpha:aa});
        txt(ctx,'Every entry carries the SHA-256 hash of the prior entry. Alter one line — every downstream hash breaks.',
          W/2,350,{size:11,color:C.dim,align:'center',alpha:aa});
        dline(ctx,76,358,1028,358,{color:C.border,alpha:aa});

        // Audit entries
        const logE=[
          {c:C.green,t:'10:14:32  optimize   success  risk=32  hash: a3f9c2e4b1d...  prev: genesis'},
          {c:C.red,  t:'10:15:01  optimize   blocked  risk=75  hash: 9d72a1fc3e8...  prev: a3f9c2e4'},
          {c:C.green,t:'10:17:44  approve    success  risk=45  hash: f2e48b377a1...  prev: 9d72a1fc'},
        ];
        logE.forEach((e,i)=>{
          txt(ctx,e.t,78,372+i*26,{size:10.5,color:e.c,mono:true,alpha:fi(lf,150+i*20,22)*ao});
        });

        // Custom rules + Config Lock callout — stays within safe zone (y ≤ 496)
        const ca=fi(lf,600,25)*ao;
        box(ctx,60,468,960,28,{fill:C.purple+'10',stroke:C.purple+'30',r:8,alpha:ca});
        txt(ctx,'🔧  25 custom org rules  ·  Config Lock enforces policy at runtime  ·  Block API keys, PII, and production DB references.',
          W/2,483,{size:12,color:C.text,align:'center',alpha:ca});

        narrator(ctx,
          ['In Enterprise mode, prompts above your risk threshold are blocked before the model ever runs.',
           'Every decision is logged with SHA-256 chaining — tamper one entry, the whole chain invalidates.'],
          lf,90,lt-90);
        drawChapter(ctx,7,10,'Enterprise',lf,0);
      }
    },

    // ─── 8 · SUMMARY  (7650–8700 = 35 s = 1050 frames) ───────────────
    {
      start:7650, end:8700, title:'Summary',
      draw(ctx,lf,lt) {
        const ao=lf>lt-35?fo(lf,lt-35,35):1;

        txt(ctx,'Everything you get',W/2,52,{size:32,bold:true,align:'center',alpha:fi(lf,8,28)*ao});
        txt(ctx,'One tool. Every prompt. Zero compromise.',W/2,90,
          {size:15,color:C.muted,align:'center',alpha:fi(lf,25,28)*ao});
        const vba=fi(lf,38,24)*ao;
        pill(ctx,W/2,112,'v4.0.3  ·  claude-prompt-optimizer-mcp',C.primary,vba);

        const stats=[
          {val:'+32', unit:'avg pts',  desc:'Score improvement per prompt',    color:C.green,   icon:'🏆'},
          {val:'94%', unit:'cheaper',  desc:'vs. Claude 3.5 for simple tasks', color:C.primary, icon:'💸'},
          {val:'<1s', unit:'per call', desc:'Full analysis, zero LLM calls',   color:C.yellow,  icon:'⚡'},
          {val:'19',  unit:'tools',    desc:'All exposed via MCP protocol',     color:C.cyan,    icon:'🛠️'},
          {val:'14',  unit:'rules',    desc:'Built-in risk & quality checks',   color:C.orange,  icon:'🔍'},
          {val:'₹0',  unit:'to start', desc:'Free tier, no credit card',        color:C.purple,  icon:'🆓'},
        ];

        stats.forEach((s,i)=>{
          const col=i%3, row=Math.floor(i/3);
          const bx=66+col*332, by=132+row*148;
          const bw=308, bh=128;
          const cx2=bx+bw/2;
          const sa=fi(lf,42+i*28,28)*ao;
          const scaleIn=fi_spring(lf,42+i*28,34);

          ctx.save();
          ctx.translate(cx2,by+bh/2); ctx.scale(scaleIn,scaleIn); ctx.translate(-cx2,-(by+bh/2));
          box(ctx,bx,by,bw,bh,{fill:C.surface,stroke:s.color+'38',lw:1.5,r:12,alpha:sa});
          ctx.restore();

          // Icon circle
          ctx.save(); ctx.globalAlpha=sa;
          ctx.fillStyle=s.color+'25'; ctx.strokeStyle=s.color+'55'; ctx.lineWidth=1;
          ctx.beginPath(); ctx.arc(bx+34,by+42,22,0,Math.PI*2); ctx.fill(); ctx.stroke();
          ctx.font='400 18px serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.fillText(s.icon,bx+34,by+42);
          ctx.restore();

          // Animated counter for numeric stats
          let displayVal=s.val;
          if(s.val==='+32'&&sa>0){const n=Math.round(lerp(0,32,eio(p(lf,42+i*28,50))));displayVal='+'+n;}
          if(s.val==='94%'&&sa>0){const n=Math.round(lerp(0,94,eio(p(lf,42+i*28,50))));displayVal=n+'%';}
          if(s.val==='19'&&sa>0){const n=Math.round(lerp(0,19,eio(p(lf,42+i*28,50))));displayVal=String(n);}
          if(s.val==='14'&&sa>0){const n=Math.round(lerp(0,14,eio(p(lf,42+i*28,50))));displayVal=String(n);}

          // Value + unit centered
          txt(ctx,displayVal,cx2-22,by+34,{size:28,bold:true,color:s.color,align:'right',alpha:sa});
          txt(ctx,s.unit,cx2-12,by+34,{size:13,color:C.muted,alpha:sa});
          txt(ctx,s.desc,cx2,by+62,{size:12,color:C.muted,align:'center',alpha:sa});
        });

        // Supported editors row
        const ea=fi(lf,680,25)*ao;
        txt(ctx,'Works with:',W/2,428,{size:12,color:C.dim,align:'center',alpha:ea});
        const editors=['Claude Code','Cursor','Windsurf','Any MCP-compatible IDE'];
        editors.forEach((e,i)=>pill(ctx,200+i*224,448,e,C.primary,fi(lf,700+i*18,20)*ao));

        narrator(ctx,
          ['PCP brings quality scoring, cost routing, compilation, and enterprise governance to every AI prompt.',
           'Free to install via npm — starts working immediately with Claude Code, Cursor, or Windsurf.'],
          lf,60,lt-60);
        drawChapter(ctx,8,10,'Summary',lf,0);
      }
    },

    // ─── 9 · CTA  (8700–9000 = 10 s = 300 frames) ────────────────────
    {
      start:8700, end:9000, title:'Get Started',
      draw(ctx,lf,lt) {
        const ao=lf>lt-35?fo(lf,lt-35,35):1;

        // Background glow
        ctx.save();
        const glow=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,320);
        glow.addColorStop(0,`rgba(77,124,254,${fi(lf,0,60)*ao*0.28})`);
        glow.addColorStop(0.5,`rgba(56,217,232,${fi(lf,0,60)*ao*0.1})`);
        glow.addColorStop(1,'transparent');
        ctx.fillStyle=glow; ctx.fillRect(0,0,W,H); ctx.restore();

        // Logo
        const ls=fi_spring(lf,0,55)*ao;
        ctx.save(); ctx.translate(W/2,H/2-130); ctx.scale(ls,ls);
        rr(ctx,-40,-40,80,80,18);
        const lg=ctx.createLinearGradient(-40,-40,40,40);
        lg.addColorStop(0,'#4d7cfe'); lg.addColorStop(1,'#38d9e8');
        ctx.fillStyle=lg; ctx.fill();
        ctx.fillStyle='#fff'; ctx.font="800 27px 'JetBrains Mono',monospace";
        ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('PCP',0,1);
        ctx.restore();

        txt(ctx,'Prompt Control Plane',W/2,H/2-62,{size:36,bold:true,align:'center',alpha:fi(lf,24,28)*ao});
        txt(ctx,'Governance for every AI prompt',W/2,H/2-24,{size:16,color:C.muted,align:'center',alpha:fi(lf,36,28)*ao});

        // URL badge (pulsing)
        const ua=fi(lf,48,25)*ao;
        const urlPulse=Math.sin(lf*0.12)*0.08+0.92;
        ctx.save(); ctx.globalAlpha=ua*urlPulse;
        rr(ctx,W/2-220,H/2+8,440,48,10);
        ctx.fillStyle=C.surface2; ctx.fill(); ctx.strokeStyle=C.primary+'70'; ctx.lineWidth=1.5; ctx.stroke();
        ctx.restore();
        txt(ctx,'prompt-control-plane.pages.dev',W/2,H/2+33,
          {size:15,color:C.primary,align:'center',bold:true,mono:true,alpha:ua});

        // Tier badges
        const tiers=[{n:'Free',p:'₹0',c:C.green},{n:'Pro',p:'₹499/mo',c:C.primary},
          {n:'Power',p:'₹899/mo',c:C.cyan},{n:'Enterprise',p:'Custom',c:C.purple}];
        tiers.forEach((t,i)=>{
          const ta=fi(lf,62+i*14,22)*ao;
          const tx=136+i*204, tw2=154, th=60;
          box(ctx,tx-tw2/2,H/2+72,tw2,th,{fill:C.surface,stroke:t.c+'44',r:8,alpha:ta});
          txt(ctx,t.n,tx,H/2+95,{size:13,bold:true,color:t.c,align:'center',alpha:ta});
          txt(ctx,t.p,tx,H/2+114,{size:11,color:C.muted,align:'center',alpha:ta});
        });

        // Install command
        const ia=fi(lf,120,22)*ao;
        box(ctx,W/2-318,H/2+150,636,44,{fill:C.surface,stroke:C.border2,r:8,alpha:ia});
        txt(ctx,'npm install -g claude-prompt-optimizer-mcp',W/2,H/2+173,
          {size:13,color:C.green,align:'center',mono:true,alpha:ia});

        narrator(ctx,
          ['Start free. No card required.',
           'npm install · Claude Code · Cursor · Windsurf'],
          lf,65,lt-65);
        drawChapter(ctx,9,10,'Get Started',lf,0);
      }
    },
  ];

  // ━━━ SCENE TRANSITIONS (cross-fade to black) ━━━━━━━━━━━━━━━━━━━━━━━
  const FADE=20;
  function applyTransitions(ctx,frame) {
    scenes.forEach((s,si)=>{
      if(si===0)return;
      if(frame>=s.start-FADE&&frame<s.start){
        const prog=(frame-(s.start-FADE))/FADE;
        ctx.save(); ctx.globalAlpha=eio(prog)*0.88;
        ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H); ctx.restore();
      }
      if(frame>=s.start&&frame<s.start+FADE){
        const prog=(frame-s.start)/FADE;
        ctx.save(); ctx.globalAlpha=(1-eout(prog))*0.88;
        ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H); ctx.restore();
      }
    });
  }

  // ━━━ INIT & RENDER LOOP ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  window.addEventListener('DOMContentLoaded',()=>{
    const canvas=document.getElementById('pcp-canvas');
    if(!canvas)return;
    const ctx=canvas.getContext('2d');
    canvas.width=W; canvas.height=H;

    // Retina / HiDPI
    const dpr=Math.min(window.devicePixelRatio||1,2);
    if(dpr>1){
      const cssW=canvas.offsetWidth||W;
      canvas.width=W*dpr; canvas.height=H*dpr;
      canvas.style.width=cssW+'px'; canvas.style.height='auto';
      ctx.scale(dpr,dpr);
    }

    let frame=0, playing=false, rafId=null;

    const playBtn    = document.getElementById('vc-play');
    const restartBtn = document.getElementById('vc-restart');
    const progFill   = document.getElementById('vc-progress');
    const progWrap   = document.getElementById('vc-progress-wrap');
    const timeLabel  = document.getElementById('vc-time');

    function fmt(f){const s=Math.floor(f/FPS);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}

    function drawFrame(){
      drawBg(ctx);
      for(const scene of scenes){
        if(frame>=scene.start&&frame<scene.end){
          scene.draw(ctx,frame-scene.start,scene.end-scene.start,frame); break;
        }
      }
      applyTransitions(ctx,frame);
      if(progFill)progFill.style.width=(frame/TOTAL_FRAMES*100)+'%';
      if(timeLabel)timeLabel.textContent=fmt(frame)+' / 5:00';
    }

    function tick(){
      if(!playing)return;
      frame++;
      if(frame>=TOTAL_FRAMES){frame=TOTAL_FRAMES-1;playing=false;updateBtn();}
      drawFrame();
      rafId=requestAnimationFrame(tick);
    }

    function updateBtn(){
      if(!playBtn)return;
      playBtn.textContent=playing?'⏸ Pause':(frame>=TOTAL_FRAMES-1?'↺ Replay':'▶ Play');
    }

    if(playBtn)playBtn.addEventListener('click',()=>{
      if(frame>=TOTAL_FRAMES-1)frame=0;
      playing=!playing; updateBtn(); if(playing)tick();
    });

    if(restartBtn)restartBtn.addEventListener('click',()=>{
      frame=0;playing=false;updateBtn();drawFrame();
    });

    if(progWrap)progWrap.addEventListener('click',e=>{
      const rect=progWrap.getBoundingClientRect();
      frame=Math.floor((e.clientX-rect.left)/rect.width*TOTAL_FRAMES);
      drawFrame();
    });

    // Keyboard: Space=play/pause, ←→=skip 8 s
    document.addEventListener('keydown',e=>{
      if(!document.getElementById('pcp-canvas'))return;
      if(e.code==='Space'){
        e.preventDefault();
        if(frame>=TOTAL_FRAMES-1)frame=0;
        playing=!playing; updateBtn(); if(playing)tick();
      }
      if(e.code==='ArrowRight'){frame=Math.min(TOTAL_FRAMES-1,frame+FPS*8);drawFrame();}
      if(e.code==='ArrowLeft') {frame=Math.max(0,frame-FPS*8);drawFrame();}
    });

    // Autoplay when 50% visible
    const obs=new IntersectionObserver(([entry])=>{
      if(entry.isIntersecting&&entry.intersectionRatio>=0.5&&!playing&&frame===0){
        playing=true;updateBtn();tick();
      }
    },{threshold:0.5});
    obs.observe(canvas);

    drawFrame();
  });
})();
