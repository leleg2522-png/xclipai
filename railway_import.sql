-- ===== XCLIP DATABASE SCHEMA =====
-- Copy semua ini ke Railway Query dan Run

-- Table: payments
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    package VARCHAR(50) NOT NULL,
    amount INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    proof_image TEXT,
    admin_notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Table: rooms
CREATE TABLE IF NOT EXISTS rooms (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    max_users INTEGER DEFAULT 10,
    active_users INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'OPEN',
    provider_key_name VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    provider VARCHAR(50) DEFAULT 'freepik',
    key_name_1 VARCHAR(100),
    key_name_2 VARCHAR(100),
    key_name_3 VARCHAR(100)
);

-- Table: subscription_plans
CREATE TABLE IF NOT EXISTS subscription_plans (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    duration_days INTEGER NOT NULL,
    price_idr INTEGER NOT NULL,
    features JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    plan_id INTEGER,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP
);

-- Table: users
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    room_id INTEGER,
    xmaker_room_id INTEGER,
    freepik_api_key TEXT,
    is_admin BOOLEAN DEFAULT FALSE,
    subscription_expired_at TIMESTAMP
);

-- Table: user_rooms
CREATE TABLE IF NOT EXISTS user_rooms (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    room_id INTEGER,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: xclip_api_keys
CREATE TABLE IF NOT EXISTS xclip_api_keys (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    api_key VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: xmaker_rooms
CREATE TABLE IF NOT EXISTS xmaker_rooms (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    max_users INTEGER DEFAULT 10,
    active_users INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'OPEN',
    provider VARCHAR(50) DEFAULT 'freepik',
    key_name_1 VARCHAR(100),
    key_name_2 VARCHAR(100),
    key_name_3 VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===== INSERT DATA =====

-- Rooms data
INSERT INTO rooms (id, name, max_users, active_users, status, provider, key_name_1, key_name_2, key_name_3) VALUES
(1, 'Room 1', 10, 0, 'OPEN', 'freepik', 'ROOM1_FREEPIK_KEY_1', 'ROOM1_FREEPIK_KEY_2', 'ROOM1_FREEPIK_KEY_3'),
(2, 'Room 2', 10, 0, 'OPEN', 'freepik', 'ROOM2_FREEPIK_KEY_1', 'ROOM2_FREEPIK_KEY_2', 'ROOM2_FREEPIK_KEY_3'),
(3, 'Room 3', 10, 0, 'OPEN', 'freepik', 'ROOM3_FREEPIK_KEY_1', 'ROOM3_FREEPIK_KEY_2', 'ROOM3_FREEPIK_KEY_3')
ON CONFLICT DO NOTHING;

-- XMaker rooms data
INSERT INTO xmaker_rooms (id, name, max_users, active_users, status, provider, key_name_1, key_name_2, key_name_3) VALUES
(1, 'XMaker Room 1', 10, 0, 'OPEN', 'freepik', 'ROOM1_FREEPIK_KEY_1', 'ROOM1_FREEPIK_KEY_2', 'ROOM1_FREEPIK_KEY_3'),
(2, 'XMaker Room 2', 10, 0, 'OPEN', 'freepik', 'ROOM2_FREEPIK_KEY_1', 'ROOM2_FREEPIK_KEY_2', 'ROOM2_FREEPIK_KEY_3'),
(3, 'XMaker Room 3', 10, 0, 'OPEN', 'freepik', 'ROOM3_FREEPIK_KEY_1', 'ROOM3_FREEPIK_KEY_2', 'ROOM3_FREEPIK_KEY_3')
ON CONFLICT DO NOTHING;

-- Subscription plans
INSERT INTO subscription_plans (id, name, duration_days, price_idr, features) VALUES
(1, '1 Hari', 1, 15000, '["Akses semua fitur", "Video Gen unlimited", "X Maker unlimited", "AI Chat unlimited"]'),
(2, '7 Hari', 7, 80000, '["Akses semua fitur", "Video Gen unlimited", "X Maker unlimited", "AI Chat unlimited", "Hemat 20%"]'),
(3, '1 Bulan', 30, 270000, '["Akses semua fitur", "Video Gen unlimited", "X Maker unlimited", "AI Chat unlimited", "Hemat 40%", "Priority support"]')
ON CONFLICT DO NOTHING;

-- Reset sequences
SELECT setval('rooms_id_seq', (SELECT MAX(id) FROM rooms));
SELECT setval('xmaker_rooms_id_seq', (SELECT MAX(id) FROM xmaker_rooms));
SELECT setval('subscription_plans_id_seq', (SELECT MAX(id) FROM subscription_plans));
