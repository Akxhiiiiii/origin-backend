import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

const SECTOR_INVESTOR_MAP = {
  FinTech:    ['inv-rajan', 'inv-nithin'],
  HealthTech: ['inv-surge', 'inv-nithin', 'inv-vineeta'],
  EdTech:     ['inv-rajan', 'inv-surge'],
  PropTech:   ['inv-rajan'],
  CleanTech:  ['inv-surge', 'inv-nithin'],
  SaaS:       ['inv-rajan'],
  D2C:        ['inv-surge', 'inv-vineeta'],
  AgriTech:   ['inv-surge'],
  Other:      ['inv-rajan', 'inv-surge'],
  General:    ['inv-rajan', 'inv-surge'],
};

const STAGE_SCORES = {
  'Idea Stage': 70,
  'Validation Stage': 82,
  'Pitch Preparation': 91,
  'Fundraising Readiness': 96,
};

router.get('/matches', requireAuth, requireRole('founder'), asyncHandler(async (req, res) => {
  const { data: session } = await supabase
    .from('founder_sessions')
    .select('current_stage, ai_messages_count')
    .eq('user_id', req.user.id)
    .single();

  const { data: profile } = await supabase
    .from('profiles')
    .select('sector, stage')
    .eq('user_id', req.user.id)
    .single();

  const stage = session?.current_stage || profile?.stage || 'Idea Stage';
  const sector = profile?.sector || 'General';
  const msgCount = session?.ai_messages_count || 0;
  const score = Math.min((STAGE_SCORES[stage] || 70) + Math.min(msgCount * 2, 10), 100);

  const matchedSlugs = SECTOR_INVESTOR_MAP[sector] || SECTOR_INVESTOR_MAP.General;
  const { data: investors, error } = await supabase
    .from('investors')
    .select('id, slug, name, firm, emoji, focus_sectors, stage_focus, cheque_range, thesis, portfolio')
    .in('slug', matchedSlugs);

  if (error) throw error;

  const matchReasons = {
    'inv-rajan': `Your ${sector} startup aligns with Peak XV's internet-first thesis. The ${stage} stage fits their portfolio sweet spot.`,
    'inv-surge': `Surge actively backs ${sector} founders at ${stage}. Strong fit with their early-stage India mandate.`,
    'inv-nithin': `Rainmatter's mission-driven focus in ${sector} matches your stage and vision.`,
    'inv-vineeta': `Vineeta Singh actively backs ${sector} founders — especially those showing early traction like you.`,
  };

  const { data: notifications } = await supabase
    .from('investor_notifications')
    .select('investor_id')
    .eq('founder_id', req.user.id);

  const notifiedIds = new Set((notifications || []).map(n => n.investor_id));

  res.json({
    investors: investors.map(inv => ({
      id: inv.id,
      name: inv.name,
      firm: inv.firm,
      emoji: inv.emoji,
      focusSectors: inv.focus_sectors,
      stageFocus: inv.stage_focus,
      chequeRange: inv.cheque_range,
      thesis: inv.thesis,
      portfolio: inv.portfolio,
      matchReason: matchReasons[inv.slug] || '',
      notified: notifiedIds.has(inv.id),
    })),
    score,
    stage,
    sector,
  });
}));

router.post('/:investorId/notify', requireAuth, requireRole('founder'), asyncHandler(async (req, res) => {
  const { investorId } = req.params;

  const { data: investor } = await supabase
    .from('investors')
    .select('id, name')
    .eq('id', investorId)
    .single();

  if (!investor) {
    return res.status(404).json({ error: 'Investor not found' });
  }

  const { data: existing } = await supabase
    .from('investor_notifications')
    .select('id')
    .eq('founder_id', req.user.id)
    .eq('investor_id', investorId)
    .single();

  if (existing) {
    return res.status(409).json({ error: 'Already notified this investor' });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('startup_name, sector, stage, tagline')
    .eq('user_id', req.user.id)
    .single();

  await supabase.from('investor_notifications').insert({
    founder_id: req.user.id,
    investor_id: investorId,
    startup_name: profile?.startup_name || req.user.name + "'s Startup",
    sector: profile?.sector || 'General',
    stage: profile?.stage || 'Idea Stage',
    tagline: profile?.tagline || '',
    status: 'sent',
  });

  res.status(201).json({ message: `${investor.name.split(' ')[0]} has been notified about your startup!` });
}));

router.get('/inbox', requireAuth, requireRole('investor'), asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('investor_notifications')
    .select(`id, startup_name, sector, stage, tagline, status, created_at, users!founder_id (id, name)`)
    .order('created_at', { ascending: false });

  if (error) throw error;

  res.json({
    inbox: data.map(n => ({
      id: n.id,
      startupName: n.startup_name,
      founderName: n.users.name,
      founderId: n.users.id,
      sector: n.sector,
      stage: n.stage,
      tagline: n.tagline,
      createdAt: n.created_at,
    })),
    total: data.length,
  });
}));

export default router;
