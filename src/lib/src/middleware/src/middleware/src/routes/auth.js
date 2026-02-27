import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

const signupSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(80),
  email: z.string().email('Invalid email address').toLowerCase(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['founder', 'investor', 'mentor'], {
    errorMap: () => ({ message: 'Role must be founder, investor, or mentor' }),
  }),
});

const signinSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

function generateToken(userId) {
  return jwt.sign(
    { sub: userId, iat: Math.floor(Date.now() / 1000) },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

router.post('/signup', asyncHandler(async (req, res) => {
  const data = signupSchema.parse(req.body);

  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', data.email)
    .single();

  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  const { data: user, error } = await supabase
    .from('users')
    .insert({
      name: data.name,
      email: data.email,
      password_hash: passwordHash,
      role: data.role,
      is_active: true,
    })
    .select('id, name, email, role, created_at')
    .single();

  if (error) {
    console.error('Signup DB error:', error);
    throw new Error('Failed to create account');
  }

  if (data.role === 'founder') {
    await supabase.from('founder_sessions').insert({ user_id: user.id });
  }

  const token = generateToken(user.id);

  res.status(201).json({
    message: 'Account created successfully',
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
}));

router.post('/signin', asyncHandler(async (req, res) => {
  const data = signinSchema.parse(req.body);

  const { data: user, error } = await supabase
    .from('users')
    .select('id, name, email, role, password_hash, is_active, mentor_id')
    .eq('email', data.email)
    .single();

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  if (!user.is_active) {
    return res.status(403).json({ error: 'Account is deactivated. Contact support.' });
  }

  const passwordMatch = await bcrypt.compare(data.password, user.password_hash);
  if (!passwordMatch) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  await supabase
    .from('users')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', user.id);

  const token = generateToken(user.id);

  res.json({
    message: 'Signed in successfully',
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      mentorId: user.mentor_id,
    },
  });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const { data: user } = await supabase
    .from('users')
    .select(`
      id, name, email, role, created_at, last_seen_at,
      founder_sessions (current_stage, stage_index, ai_messages_count, profile_published),
      mentors (name, role_title, tags)
    `)
    .eq('id', req.user.id)
    .single();

  res.json({ user });
}));

router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Both current and new password are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const { data: user } = await supabase
    .from('users')
    .select('password_hash')
    .eq('id', req.user.id)
    .single();

  const match = await bcrypt.compare(currentPassword, user.password_hash);
  if (!match) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await supabase
    .from('users')
    .update({ password_hash: newHash })
    .eq('id', req.user.id);

  res.json({ message: 'Password updated successfully' });
}));

export default router;
