CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS mentors (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID,
  name            TEXT NOT NULL,
  role_title      TEXT NOT NULL,
  emoji           TEXT NOT NULL DEFAULT '👤',
  av_class        TEXT DEFAULT 'av1',
  rating          DECIMAL(3,1) DEFAULT 4.5,
  review_count    INTEGER DEFAULT 0,
  tags            TEXT[] DEFAULT '{}',
  bio             TEXT,
  expertise       TEXT,
  portfolio       TEXT[] DEFAULT '{}',
  is_active       BOOLEAN DEFAULT TRUE,
  display_order   INTEGER DEFAULT 99,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('founder', 'investor', 'mentor', 'admin')),
  is_active       BOOLEAN DEFAULT TRUE,
  mentor_id       UUID REFERENCES mentors(id) ON DELETE SET NULL,
  last_seen_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role  ON users(role);

CREATE TABLE IF NOT EXISTS founder_sessions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  current_stage       TEXT DEFAULT 'Idea Stage',
  stage_index         INTEGER DEFAULT 0,
  ai_messages_count   INTEGER DEFAULT 0,
  profile_published   BOOLEAN DEFAULT FALSE,
  checklist_state     JSONB DEFAULT '{}',
  last_active_at      TIMESTAMPTZ DEFAULT NOW(),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_founder_sessions_user ON founder_sessions(user_id);

CREATE TABLE IF NOT EXISTS chat_history (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chat_history_user  ON chat_history(user_id);
CREATE INDEX idx_chat_history_stage ON chat_history(user_id, stage);

CREATE TABLE IF NOT EXISTS profiles (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  startup_name    TEXT NOT NULL,
  tagline         TEXT NOT NULL,
  description     TEXT,
  sector          TEXT NOT NULL,
  contact_email   TEXT NOT NULL,
  stage           TEXT NOT NULL,
  emoji           TEXT DEFAULT '🚀',
  website         TEXT,
  pitch_deck_url  TEXT,
  is_published    BOOLEAN DEFAULT FALSE,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_profiles_published ON profiles(is_published, stage, sector);

CREATE TABLE IF NOT EXISTS investors (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  firm            TEXT NOT NULL,
  emoji           TEXT DEFAULT '💼',
  focus_sectors   TEXT[] DEFAULT '{}',
  stage_focus     TEXT[] DEFAULT '{}',
  cheque_range    TEXT,
  thesis          TEXT,
  portfolio       TEXT[] DEFAULT '{}',
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS investor_notifications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  founder_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  investor_id     UUID REFERENCES investors(id) ON DELETE CASCADE,
  startup_name    TEXT,
  sector          TEXT,
  stage           TEXT,
  tagline         TEXT,
  status          TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'viewed', 'responded')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(founder_id, investor_id)
);

CREATE TABLE IF NOT EXISTS connection_requests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  investor_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  founder_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  profile_id      UUID REFERENCES profiles(id) ON DELETE CASCADE,
  message         TEXT,
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(investor_id, profile_id)
);

CREATE TABLE IF NOT EXISTS mentor_requests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  founder_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  mentor_id       UUID REFERENCES mentors(id) ON DELETE CASCADE,
  founder_name    TEXT NOT NULL,
  startup_name    TEXT NOT NULL,
  stage           TEXT,
  one_liner       TEXT,
  help_needed     TEXT NOT NULL,
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'passed')),
  is_pitch        BOOLEAN DEFAULT FALSE,
  responded_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mentor_requests_mentor  ON mentor_requests(mentor_id, status);
CREATE INDEX idx_mentor_requests_founder ON mentor_requests(founder_id);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at    BEFORE UPDATE ON users    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION increment_ai_messages(user_uuid UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE founder_sessions
  SET ai_messages_count = ai_messages_count + 1
  WHERE user_id = user_uuid;
END;
$$ LANGUAGE plpgsql;

INSERT INTO investors (slug, name, firm, emoji, focus_sectors, stage_focus, cheque_range, thesis, portfolio) VALUES
  ('inv-rajan',   'Rajan Anandan',  'Peak XV Partners', '🦁', ARRAY['SaaS','EdTech','Consumer Internet'], ARRAY['Seed','Series A'], '₹2Cr – ₹20Cr', 'Backs exceptional founders tackling large Indian market problems.', ARRAY['Unacademy','Khatabook','Meesho','Vedantu']),
  ('inv-surge',   'Sequoia Surge',  'Surge by Peak XV', '🌊', ARRAY['HealthTech','FinTech','D2C','CleanTech'], ARRAY['Idea Stage','Validation Stage'], '$1M – $2M', 'Early bets on seed-stage founders in India with strong founder-market fit.', ARRAY['Bukukas','Classplus','Ninjacart','Jar']),
  ('inv-nithin',  'Nithin Kamath',  'Rainmatter Capital', '📈', ARRAY['FinTech','HealthTech','CleanTech'], ARRAY['Validation Stage','Pitch Preparation'], '₹50L – ₹5Cr', 'Mission-driven backing — finance, health and climate.', ARRAY['Smallcase','Nirog Street','Gramophone','Ditto Insurance']),
  ('inv-vineeta', 'Vineeta Singh',  'SUGAR Cosmetics & Angel Investor', '💄', ARRAY['D2C','HealthTech','Consumer'], ARRAY['Idea Stage','Validation Stage','Pitch Preparation'], '₹25L – ₹2Cr', 'Champions D2C consumer brands and women-founded startups.', ARRAY['SUGAR Cosmetics','The Ayurveda Co.','Plix','Snitch'])
ON CONFLICT (slug) DO NOTHING;

INSERT INTO mentors (name, role_title, emoji, av_class, rating, review_count, tags, bio, expertise, portfolio, display_order) VALUES
  ('Aman Gupta', 'Co-founder & CMO, boAt', '🎧', 'av1', 4.9, 214, ARRAY['D2C','Consumer Electronics','Brand Building'], 'Aman Gupta co-founded boAt in 2016, turning it into India''s #1 audio brand.', 'D2C scaling, brand building, consumer marketing, fundraising strategy', ARRAY['boAt (founder)','Skippi Ice Pops','Hammer','Wakao Foods'], 1),
  ('Piyush Bansal', 'Founder & CEO, Lenskart', '👓', 'av2', 4.8, 187, ARRAY['Retail-Tech','D2C','Operations'], 'Piyush Bansal founded Lenskart in 2010, disrupting India''s ₹10,000 Cr eyewear market.', 'Omnichannel retail, operations at scale, product-market fit, global expansion', ARRAY['Lenskart (founder)','Setu','The Bear House','Tagz Foods'], 2),
  ('Namita Thapar', 'Executive Director, Emcure Pharmaceuticals', '💊', 'av3', 4.9, 203, ARRAY['HealthTech','Pharma','Women-led'], 'Namita Thapar leads Emcure Pharmaceuticals, a ₹6,000 Cr global pharma company.', 'Healthcare, pharma, women entrepreneurship, scaling family businesses', ARRAY['Emcure','Skippi Ice Pops','Heads Up For Tails','Snitch'], 3),
  ('Anupam Mittal', 'Founder & CEO, Shaadi.com', '🌐', 'av4', 4.7, 176, ARRAY['Internet','SaaS','Early Stage'], 'Anupam Mittal founded Shaadi.com in 1997. A prolific angel investor with 200+ investments.', 'Internet businesses, early-stage investing, product strategy, founder mindset', ARRAY['Shaadi.com (founder)','Ola','Rapido','Mamaearth','Mfine'], 4)
ON CONFLICT DO NOTHING;

ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE founder_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_history           ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentor_requests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE connection_requests    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users: own record only" ON users FOR ALL USING (auth.uid() = id);
CREATE POLICY "Profiles: public read" ON profiles FOR SELECT USING (is_published = TRUE);
CREATE POLICY "Profiles: owner write" ON profiles FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Chat: owner only" ON chat_history FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Sessions: owner only" ON founder_sessions FOR ALL USING (auth.uid() = user_id);
