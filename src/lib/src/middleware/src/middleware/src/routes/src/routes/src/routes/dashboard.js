import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

const STAGE_ORDER = ['Idea Stage', 'Validation Stage', 'Pitch Preparation', 'Fundraising Readiness'];
const STAGE_SCORES = { 'Idea Stage': 70, 'Validation Stage': 82, 'Pitch Preparation': 91, 'Fundraising Readiness': 96 };

const CHECKLISTS = {
  'Idea Stage': ['Define core problem', 'Identify target customers', 'Research existing solutions', 'Articulate value proposition', 'Document your idea'],
  'Validation Stage': ['Conduct 10+ customer interviews', 'Build basic MVP', 'Collect user feedback', 'Validate demand', 'Refine value proposition'],
  'Pitch Preparation': ['Create 10-slide investor deck', 'Define ask and use of funds', 'Prepare investor Q&A', 'Rehearse pitch', 'Research 10+ investors'],
  'Fundraising Readiness': ['Finalize 3-year projections', 'Set up data room', 'Identify lead investors', 'Prepare term sheet expectations', 'Brief team on due diligence'],
};

router.get('/', requireAuth, requireRole('founder'), asyncHandler(async (req, res) => {
  const { data: session } = await supabase
    .from('founder_sessions')
    .select('current_stage, stage_index, ai_messages_count, profile_published, checklist_state, last_active_at')
    .eq('user_id', req.user.id)
    .single();

  const { data: profile } = await supabase
    .from('profiles')
    .select('startup_name, sector, stage, tagline, is_published')
    .eq('user_id', req.user.id)
    .single();

  const stage = session?.current_stage || null;
  const stageIdx = stage ? STAGE_ORDER.indexOf(stage) : -1;
  const totalStages = STAGE_ORDER.length;
  const progress = stage ? Math.round(((stageIdx + 1) / totalStages) * 100) : 0;
  const msgCount = session?.ai_messages_count || 0;
  const baseScore = STAGE_SCORES[stage] || 60;
  const aiBonus = Math.min(msgCount * 2, 10);
  const publishBonus = profile?.is_published ? 5 : 0;
  const readinessScore = Math.min(baseScore + aiBonus + publishBonus, 100);

  const checklistState = session?.checklist_state || {};
  const checklist = stage ? CHECKLISTS[stage].map((item, i) => ({
    id: `${stage}-${i}`,
    label: item,
    done: checklistState[`${stage}-${i}`] || false,
  })) : [];

  res.json({
    role: req.user.role,
    stage,
    stageIndex: stageIdx,
    totalStages,
    progress,
    msgCount,
    readinessScore,
    profilePublished: profile?.is_published || false,
    startup: profile ? { name: profile.startup_name, sector: profile.sector, tagline: profile.tagline } : null,
    checklist,
    lastActive: session?.last_active_at,
  });
}));

router.patch('/stage', requireAuth, requireRole('founder'), asyncHandler(async (req, res) => {
  const { stage } = req.body;
  if (!STAGE_ORDER.includes(stage)) {
    return res.status(400).json({ error: `Invalid stage. Must be one of: ${STAGE_ORDER.join(', ')}` });
  }
  const stageIdx = STAGE_ORDER.indexOf(stage);
  await supabase
    .from('founder_sessions')
    .update({ current_stage: stage, stage_index: stageIdx, last_active_at: new Date().toISOString() })
    .eq('user_id', req.user.id);
  res.json({ message: `Stage updated to ${stage}`, stageIndex: stageIdx });
}));

router.patch('/checklist', requireAuth, requireRole('founder'), asyncHandler(async (req, res) => {
  const { itemId, done } = req.body;
  if (!itemId || typeof done !== 'boolean') {
    return res.status(400).json({ error: 'itemId and done (boolean) are required' });
  }
  const { data: session } = await supabase
    .from('founder_sessions')
    .select('checklist_state')
    .eq('user_id', req.user.id)
    .single();
  const current = session?.checklist_state || {};
  current[itemId] = done;
  await supabase.from('founder_sessions').update({ checklist_state: current }).eq('user_id', req.user.id);
  res.json({ message: 'Checklist updated', checklistState: current });
}));

router.get('/report', requireAuth, requireRole('founder'), asyncHandler(async (req, res) => {
  const { data: session } = await supabase
    .from('founder_sessions')
    .select('current_stage, ai_messages_count, checklist_state')
    .eq('user_id', req.user.id)
    .single();

  const { data: profile } = await supabase
    .from('profiles')
    .select('startup_name, sector, stage, is_published')
    .eq('user_id', req.user.id)
    .single();

  const stage = session?.current_stage || 'Idea Stage';
  const msgCount = session?.ai_messages_count || 0;
  const baseScore = STAGE_SCORES[stage] || 70;
  const aiBonus = Math.min(msgCount * 2, 10);
  const publishBonus = profile?.is_published ? 5 : 0;
  const score = Math.min(baseScore + aiBonus + publishBonus, 100);

  const strengths = [];
  const improvements = [];
  if (msgCount >= 5) strengths.push('Deep AI engagement');
  if (STAGE_ORDER.indexOf(stage) > 0) strengths.push('Stage progression');
  if (profile?.is_published) strengths.push('Published profile');
  if (strengths.length === 0) strengths.push('Started the journey');
  if (msgCount < 5) improvements.push('Engage more with AI guidance');
  if (!profile?.is_published) improvements.push('Publish your founder profile');
  if (STAGE_ORDER.indexOf(stage) < 2) improvements.push('Advance through more stages');

  res.json({
    startupName: profile?.startup_name || req.user.name + "'s Startup",
    stage,
    score,
    sector: profile?.sector || 'General',
    strengths,
    improvements,
    msgCount,
    generatedAt: new Date().toISOString(),
  });
}));

export default router;
