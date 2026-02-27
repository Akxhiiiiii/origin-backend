import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.AI_RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'AI rate limit exceeded. Please wait a few minutes.' },
});

const messageSchema = z.object({
  stage: z.string().min(1),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(4000),
  })).min(1).max(100),
});

const SYSTEM_PROMPTS = {
  founder: (stage) => `You are Origin AI, a structured startup guidance assistant built specifically for Indian founders. The user is a startup founder currently at the "${stage}" stage.

Your personality:
- Warm, direct, practical — like a smart co-founder who's seen it all
- Stage-specific: don't give Series A advice to an Idea Stage founder
- India-focused: reference Indian market dynamics, SEBI regulations, Indian VCs, India Stack, UPI, etc. when relevant
- Ask one focused clarifying question at a time — never overwhelm with questions
- Be concise but insightful. Under 300 words unless asked for detail.

Stage context for "${stage}":
${getStageContext(stage)}`,

  investor: (stage) => `You are Origin AI, an investment research assistant with deep knowledge of companies, startups, and brands — with a focus on the Indian startup ecosystem.

Your role at the "${stage}" stage: ${getInvestorStageContext(stage)}

Rules:
- Never say you don't have information — use your training knowledge
- Never ask clarifying questions before answering — always lead with the information
- Keep responses structured with headers and concise bullet points
- Reference Indian market context, funding environment, and comparable startups where relevant`,
};

function getStageContext(stage) {
  const ctx = {
    'Idea Stage': 'Help the founder clearly define their problem, identify target customers, and articulate a compelling value proposition. Focus on problem clarity before solution.',
    'Validation Stage': 'Guide the founder through customer discovery, MVP thinking, and early traction metrics. Emphasize talking to real customers over building.',
    'Pitch Preparation': 'Help the founder craft a compelling investor narrative. Cover: problem/solution, market size, business model, traction, team, ask.',
    'Fundraising Readiness': 'Help the founder get investor-ready: financial projections, data room, term sheet basics, due diligence prep, investor targeting strategy.',
  };
  return ctx[stage] || 'Provide general startup guidance for this stage.';
}

function getInvestorStageContext(stage) {
  const ctx = {
    'Early Idea': 'Provide a comprehensive overview: founding story, problem being solved, core philosophy, target audience. End with an "Early Idea Verdict".',
    'Pre-Seed': 'Focus on: early traction, product-market fit signals, customer acquisition, demand validation. End with a "Pre-Seed Verdict".',
    'Seed': 'Focus on: proven business model, revenue growth, key metrics, product expansion, team building. End with a "Seed Stage Verdict".',
    'Series A': 'Focus on: scale, revenue, market leadership, unit economics, expansion strategy. End with a "Series A Verdict".',
  };
  return ctx[stage] || 'Provide comprehensive investment analysis for this stage.';
}

router.post('/message', requireAuth, requireRole('founder', 'investor'), aiLimiter, asyncHandler(async (req, res) => {
  const { stage, messages } = messageSchema.parse(req.body);
  const role = req.user.role;
  const systemPrompt = SYSTEM_PROMPTS[role]?.(stage);

  if (!systemPrompt) {
    return res.status(400).json({ error: 'Invalid role for chat' });
  }

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages: messages,
  });

  const reply = response.content[0]?.text || '';

  if (role === 'founder') {
    await supabase.rpc('increment_ai_messages', { user_uuid: req.user.id });
    await supabase
      .from('founder_sessions')
      .update({ current_stage: stage, last_active_at: new Date().toISOString() })
      .eq('user_id', req.user.id);
  }

  await supabase.from('chat_history').insert({ user_id: req.user.id, stage, role: 'user', content: messages[messages.length - 1].content });
  await supabase.from('chat_history').insert({ user_id: req.user.id, stage, role: 'assistant', content: reply });

  res.json({ reply, usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } });
}));

router.get('/history', requireAuth, asyncHandler(async (req, res) => {
  const { stage, limit = 50 } = req.query;
  let query = supabase
    .from('chat_history')
    .select('id, stage, role, content, created_at')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: true })
    .limit(parseInt(limit));
  if (stage) query = query.eq('stage', stage);
  const { data, error } = await query;
  if (error) throw error;
  res.json({ messages: data });
}));

router.delete('/history', requireAuth, asyncHandler(async (req, res) => {
  const { stage } = req.query;
  let query = supabase.from('chat_history').delete().eq('user_id', req.user.id);
  if (stage) query = query.eq('stage', stage);
  await query;
  res.json({ message: 'Chat history cleared' });
}));

export default router;
