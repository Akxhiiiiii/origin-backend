import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { requireAuth, requireRole, optionalAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

const profileSchema = z.object({
  startupName: z.string().min(1).max(100),
  tagline: z.string().min(10, 'Tagline must be at least 10 characters').max(200),
  description: z.string().min(20, 'Description must be at least 20 characters').max(2000),
  sector: z.enum(['FinTech', 'HealthTech', 'EdTech', 'PropTech', 'CleanTech', 'SaaS', 'D2C', 'AgriTech', 'Other']),
  contactEmail: z.string().email(),
  stage: z.enum(['Idea Stage', 'Validation Stage', 'Pitch Preparation', 'Fundraising Readiness']),
  website: z.string().url().optional().or(z.literal('')),
  pitchDeckUrl: z.string().url().optional().or(z.literal('')),
});

router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const { stage, sector, limit = 20, offset = 0 } = req.query;

  let query = supabase
    .from('profiles')
    .select(`id, startup_name, tagline, sector, stage, emoji, website, created_at, users!inner (name, id)`)
    .eq('is_published', true)
    .order('created_at', { ascending: false })
    .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

  if (stage && stage !== 'all') query = query.eq('stage', stage);
  if (sector) query = query.eq('sector', sector);

  const { data, error } = await query;
  if (error) throw error;

  res.json({
    profiles: data.map(p => ({
      id: p.id,
      startupName: p.startup_name,
      tagline: p.tagline,
      sector: p.sector,
      stage: p.stage,
      emoji: p.emoji,
      website: p.website,
      founderName: p.users.name,
      founderId: p.users.id,
      createdAt: p.created_at,
    })),
  });
}));

router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select(`id, startup_name, tagline, description, sector, stage, emoji, website, pitch_deck_url, is_published, created_at, users!inner (id, name, email)`)
    .eq('id', req.params.id)
    .single();

  if (error || !profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }

  if (!profile.is_published && req.user?.id !== profile.users.id) {
    return res.status(403).json({ error: 'This profile is not published' });
  }

  const showContact = req.user?.role === 'investor' || req.user?.id === profile.users.id;

  res.json({
    profile: {
      id: profile.id,
      startupName: profile.startup_name,
      tagline: profile.tagline,
      description: profile.description,
      sector: profile.sector,
      stage: profile.stage,
      emoji: profile.emoji,
      website: profile.website,
      pitchDeckUrl: profile.pitch_deck_url,
      founderName: profile.users.name,
      founderId: profile.users.id,
      contactEmail: showContact ? profile.users.email : undefined,
      createdAt: profile.created_at,
    },
  });
}));

router.post('/', requireAuth, requireRole('founder'), asyncHandler(async (req, res) => {
  const data = profileSchema.parse(req.body);

  const EMOJIS = {
    FinTech: '💳', HealthTech: '🏥', EdTech: '📚', PropTech: '🏗️',
    CleanTech: '🌱', SaaS: '⚙️', D2C: '🛍️', AgriTech: '🌾', Other: '🚀',
  };

  const { data: profile, error } = await supabase
    .from('profiles')
    .upsert({
      user_id: req.user.id,
      startup_name: data.startupName,
      tagline: data.tagline,
      description: data.description,
      sector: data.sector,
      contact_email: data.contactEmail,
      stage: data.stage,
      emoji: EMOJIS[data.sector] || '🚀',
      website: data.website || null,
      pitch_deck_url: data.pitchDeckUrl || null,
      is_published: true,
      published_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    .select('id, startup_name')
    .single();

  if (error) {
    console.error('Profile publish error:', error);
    throw new Error('Failed to publish profile');
  }

  await supabase
    .from('founder_sessions')
    .update({ profile_published: true })
    .eq('user_id', req.user.id);

  res.status(201).json({
    message: `"${profile.startup_name}" is now live on Origin Discover!`,
    profileId: profile.id,
  });
}));

router.patch('/me', requireAuth, requireRole('founder'), asyncHandler(async (req, res) => {
  const data = profileSchema.partial().parse(req.body);
  const updates = {};
  if (data.startupName) updates.startup_name = data.startupName;
  if (data.tagline) updates.tagline = data.tagline;
  if (data.description) updates.description = data.description;
  if (data.sector) updates.sector = data.sector;
  if (data.stage) updates.stage = data.stage;
  if (data.website !== undefined) updates.website = data.website || null;
  if (data.pitchDeckUrl !== undefined) updates.pitch_deck_url = data.pitchDeckUrl || null;

  const { error } = await supabase.from('profiles').update(updates).eq('user_id', req.user.id);
  if (error) throw error;
  res.json({ message: 'Profile updated successfully' });
}));

router.delete('/me', requireAuth, requireRole('founder'), asyncHandler(async (req, res) => {
  await supabase.from('profiles').update({ is_published: false }).eq('user_id', req.user.id);
  res.json({ message: 'Profile unpublished' });
}));

router.post('/:id/connect', requireAuth, requireRole('investor'), asyncHandler(async (req, res) => {
  const { message } = req.body;

  const { data: profile } = await supabase
    .from('profiles')
    .select('user_id, startup_name, users(name, email)')
    .eq('id', req.params.id)
    .eq('is_published', true)
    .single();

  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }

  const { data: existing } = await supabase
    .from('connection_requests')
    .select('id, status')
    .eq('investor_id', req.user.id)
    .eq('profile_id', req.params.id)
    .single();

  if (existing) {
    return res.status(409).json({ error: `Connection request already ${existing.status}` });
  }

  const { data: request, error } = await supabase
    .from('connection_requests')
    .insert({
      investor_id: req.user.id,
      founder_id: profile.user_id,
      profile_id: req.params.id,
      message: message || null,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) throw error;

  res.status(201).json({
    message: `Connection request sent to ${profile.users.name}!`,
    requestId: request.id,
  });
}));

export default router;
