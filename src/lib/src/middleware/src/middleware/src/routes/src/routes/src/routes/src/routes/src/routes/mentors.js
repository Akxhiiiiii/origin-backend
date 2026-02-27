import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { requireAuth, requireRole, optionalAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('mentors')
    .select('id, name, role_title, emoji, av_class, rating, review_count, tags, bio, expertise, portfolio')
    .eq('is_active', true)
    .order('display_order', { ascending: true });
  if (error) throw error;
  res.json({ mentors: data });
}));

router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const { data: mentor, error } = await supabase
    .from('mentors')
    .select('id, name, role_title, emoji, av_class, rating, review_count, tags, bio, expertise, portfolio, is_active')
    .eq('id', req.params.id)
    .single();
  if (error || !mentor) {
    return res.status(404).json({ error: 'Mentor not found' });
  }
  res.json({ mentor });
}));

const pitchSchema = z.object({
  founderName: z.string().min(2).max(80),
  startupName: z.string().min(1).max(100),
  stage: z.string().min(1),
  oneLiner: z.string().min(10, 'One-liner must be at least 10 characters').max(300),
  helpNeeded: z.string().min(20, 'Please describe what help you need in more detail').max(1000),
});

router.post('/:id/pitch', requireAuth, requireRole('founder'), asyncHandler(async (req, res) => {
  const data = pitchSchema.parse(req.body);

  const { data: mentor } = await supabase
    .from('mentors')
    .select('id, name')
    .eq('id', req.params.id)
    .eq('is_active', true)
    .single();

  if (!mentor) {
    return res.status(404).json({ error: 'Mentor not found' });
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from('mentor_requests')
    .select('id')
    .eq('founder_id', req.user.id)
    .eq('mentor_id', mentor.id)
    .gte('created_at', sevenDaysAgo)
    .single();

  if (recent) {
    return res.status(429).json({ error: `You already pitched ${mentor.name} recently. Please wait before pitching again.` });
  }

  const { data: request, error } = await supabase
    .from('mentor_requests')
    .insert({
      founder_id: req.user.id,
      mentor_id: mentor.id,
      founder_name: data.founderName,
      startup_name: data.startupName,
      stage: data.stage,
      one_liner: data.oneLiner,
      help_needed: data.helpNeeded,
      status: 'pending',
      is_pitch: true,
    })
    .select('id')
    .single();

  if (error) throw error;

  res.status(201).json({
    message: `Pitch submitted to ${mentor.name}! If it resonates, they'll reach out.`,
    requestId: request.id,
  });
}));

router.get('/portal/requests', requireAuth, requireRole('mentor'), asyncHandler(async (req, res) => {
  const { status = 'pending' } = req.query;

  const { data: mentor } = await supabase
    .from('mentors')
    .select('id')
    .eq('user_id', req.user.id)
    .single();

  if (!mentor) {
    return res.status(403).json({ error: 'Mentor profile not found for this user' });
  }

  let query = supabase
    .from('mentor_requests')
    .select(`id, founder_name, startup_name, stage, one_liner, help_needed, status, is_pitch, created_at, users!founder_id (id, name, email)`)
    .eq('mentor_id', mentor.id)
    .order('created_at', { ascending: false });

  if (status !== 'all') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw error;

  res.json({
    requests: data.map(r => ({
      id: r.id,
      founderName: r.founder_name,
      startupName: r.startup_name,
      stage: r.stage,
      note: r.is_pitch ? `${r.one_liner} — ${r.help_needed}` : r.help_needed,
      status: r.status,
      isPitch: r.is_pitch,
      createdAt: r.created_at,
    })),
  });
}));

router.patch('/portal/requests/:requestId', requireAuth, requireRole('mentor'), asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['accepted', 'passed'].includes(status)) {
    return res.status(400).json({ error: 'Status must be accepted or passed' });
  }

  const { data: mentor } = await supabase
    .from('mentors')
    .select('id')
    .eq('user_id', req.user.id)
    .single();

  const { data: request, error } = await supabase
    .from('mentor_requests')
    .update({ status, responded_at: new Date().toISOString() })
    .eq('id', req.params.requestId)
    .eq('mentor_id', mentor.id)
    .select('founder_name')
    .single();

  if (error || !request) {
    return res.status(404).json({ error: 'Request not found' });
  }

  res.json({ message: status === 'accepted' ? `Session accepted with ${request.founder_name}!` : `Request from ${request.founder_name} passed.` });
}));

export default router;
