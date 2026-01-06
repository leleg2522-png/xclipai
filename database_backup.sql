--
-- PostgreSQL database dump
--

\restrict jHbFthYLUBsYAbehfn7UAdvXRiEDmdXsaDEWp5yXNlvk9LhlDfAAAJMbvcLJa82

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: payments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payments (
    id integer NOT NULL,
    user_id integer,
    package character varying(50) NOT NULL,
    amount integer NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying,
    proof_image text,
    admin_notes text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.payments OWNER TO postgres;

--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.payments_id_seq OWNER TO postgres;

--
-- Name: payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;


--
-- Name: rooms; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rooms (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    max_users integer DEFAULT 10,
    active_users integer DEFAULT 0,
    status character varying(20) DEFAULT 'OPEN'::character varying,
    provider_key_name character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    provider character varying(50) DEFAULT 'freepik'::character varying,
    key_name_1 character varying(100),
    key_name_2 character varying(100),
    key_name_3 character varying(100)
);


ALTER TABLE public.rooms OWNER TO postgres;

--
-- Name: rooms_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.rooms_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rooms_id_seq OWNER TO postgres;

--
-- Name: rooms_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.rooms_id_seq OWNED BY public.rooms.id;


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sessions (
    sid character varying NOT NULL,
    sess json NOT NULL,
    expire timestamp(6) without time zone NOT NULL
);


ALTER TABLE public.sessions OWNER TO postgres;

--
-- Name: subscription_plans; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subscription_plans (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    duration_days integer NOT NULL,
    price_idr integer NOT NULL,
    description text,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.subscription_plans OWNER TO postgres;

--
-- Name: subscription_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.subscription_plans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.subscription_plans_id_seq OWNER TO postgres;

--
-- Name: subscription_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.subscription_plans_id_seq OWNED BY public.subscription_plans.id;


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subscriptions (
    id integer NOT NULL,
    user_id integer,
    plan_id integer,
    room_id integer,
    xmaker_room_id integer,
    room_locked boolean DEFAULT false,
    status character varying(20) DEFAULT 'active'::character varying,
    expired_at timestamp without time zone,
    last_active timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    started_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.subscriptions OWNER TO postgres;

--
-- Name: subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.subscriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.subscriptions_id_seq OWNER TO postgres;

--
-- Name: subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.subscriptions_id_seq OWNED BY public.subscriptions.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying(100) NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    freepik_api_key text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_admin boolean DEFAULT false,
    subscription_expired_at timestamp without time zone
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: video_generation_tasks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.video_generation_tasks (
    id integer NOT NULL,
    task_id character varying(255) NOT NULL,
    xclip_api_key_id integer,
    user_id integer,
    model character varying(100),
    status character varying(50) DEFAULT 'pending'::character varying,
    video_url text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamp without time zone,
    room_id integer,
    key_index integer
);


ALTER TABLE public.video_generation_tasks OWNER TO postgres;

--
-- Name: video_generation_tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.video_generation_tasks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.video_generation_tasks_id_seq OWNER TO postgres;

--
-- Name: video_generation_tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.video_generation_tasks_id_seq OWNED BY public.video_generation_tasks.id;


--
-- Name: xclip_api_keys; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.xclip_api_keys (
    id integer NOT NULL,
    user_id integer,
    api_key character varying(255) NOT NULL,
    label character varying(100),
    status character varying(20) DEFAULT 'active'::character varying,
    requests_count integer DEFAULT 0,
    last_used_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.xclip_api_keys OWNER TO postgres;

--
-- Name: xclip_api_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.xclip_api_keys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.xclip_api_keys_id_seq OWNER TO postgres;

--
-- Name: xclip_api_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.xclip_api_keys_id_seq OWNED BY public.xclip_api_keys.id;


--
-- Name: payments id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);


--
-- Name: rooms id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rooms ALTER COLUMN id SET DEFAULT nextval('public.rooms_id_seq'::regclass);


--
-- Name: subscription_plans id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscription_plans ALTER COLUMN id SET DEFAULT nextval('public.subscription_plans_id_seq'::regclass);


--
-- Name: subscriptions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions ALTER COLUMN id SET DEFAULT nextval('public.subscriptions_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: video_generation_tasks id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.video_generation_tasks ALTER COLUMN id SET DEFAULT nextval('public.video_generation_tasks_id_seq'::regclass);


--
-- Name: xclip_api_keys id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.xclip_api_keys ALTER COLUMN id SET DEFAULT nextval('public.xclip_api_keys_id_seq'::regclass);


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.payments (id, user_id, package, amount, status, proof_image, admin_notes, created_at, updated_at) FROM stdin;
1	1	1 Hari	15000	approved	/uploads/payment_proofs/proof-4f3d8409-e5b3-4dec-9818-108049916c02-1767735173085.jpg	\N	2026-01-06 21:32:54.146004	2026-01-06 21:33:16.00262
\.


--
-- Data for Name: rooms; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.rooms (id, name, max_users, active_users, status, provider_key_name, created_at, provider, key_name_1, key_name_2, key_name_3) FROM stdin;
3	Room 3	5	0	OPEN	FREEPIK_API_KEY_3	2026-01-05 13:59:46.766791	freepik	ROOM3_FREEPIK_KEY_1	ROOM3_FREEPIK_KEY_2	ROOM3_FREEPIK_KEY_3
2	Room 2	5	0	OPEN	FREEPIK_API_KEY_2	2026-01-05 13:59:46.766791	freepik	ROOM2_FREEPIK_KEY_1	ROOM2_FREEPIK_KEY_2	ROOM2_FREEPIK_KEY_3
1	Room 1	5	0	OPEN	FREEPIK_API_KEY_1	2026-01-05 13:59:46.766791	freepik	ROOM1_FREEPIK_KEY_1	ROOM1_FREEPIK_KEY_2	ROOM1_FREEPIK_KEY_3
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sessions (sid, sess, expire) FROM stdin;
BqqyKBYl1FbCRIQ0MYUmLKNzO2WLQIbH	{"cookie":{"originalMaxAge":2592000000,"expires":"2026-02-04T14:13:43.874Z","secure":false,"httpOnly":true,"path":"/"},"userId":1}	2026-02-05 21:34:25
\.


--
-- Data for Name: subscription_plans; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.subscription_plans (id, name, duration_days, price_idr, description, is_active, created_at) FROM stdin;
1	1 Hari	1	15000	Akses premium selama 1 hari	t	2026-01-05 13:59:46.766791
2	7 Hari	7	80000	Akses premium selama 7 hari	t	2026-01-05 13:59:46.766791
3	1 Bulan	30	270000	Akses premium selama 30 hari	t	2026-01-05 13:59:46.766791
\.


--
-- Data for Name: subscriptions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.subscriptions (id, user_id, plan_id, room_id, xmaker_room_id, room_locked, status, expired_at, last_active, created_at, started_at) FROM stdin;
1	1	1	\N	\N	f	expired	2026-01-06 14:15:33.996	2026-01-06 11:02:56.170237	2026-01-05 14:15:33.99626	2026-01-05 14:15:33.99626
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, username, email, password_hash, freepik_api_key, created_at, updated_at, is_admin, subscription_expired_at) FROM stdin;
1	lala	lalapou@gmail.com	$2b$12$wwckK1QWm7qY53L3pUazmeg/jP23oanc7IeDnJGOKzlEO6dFCml.q	\N	2026-01-05 14:13:43.847111	2026-01-05 14:13:43.847111	t	2026-01-07 21:33:16.002
\.


--
-- Data for Name: video_generation_tasks; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.video_generation_tasks (id, task_id, xclip_api_key_id, user_id, model, status, video_url, created_at, completed_at, room_id, key_index) FROM stdin;
1	17a645bc-c422-4c7d-a463-107a1a522f05	1	1	kling-v2-1-master	completed	https://cdn-magnific.freepik.com/kling_17a645bc-c422-4c7d-a463-107a1a522f05.mp4?token=exp=1767627610~hmac=7f1c7ee4359c96c3a2546ddaa54ba7decd6a1d1dac6080280a28582d17a2a605	2026-01-05 14:32:39.921249	2026-01-05 14:40:11.736765	1	\N
2	240c38d2-ab0f-4597-b06f-8e4c42037d1f	1	1	seedance-lite-1080p	completed	https://cdn-magnific.freepik.com/kling_240c38d2-ab0f-4597-b06f-8e4c42037d1f.mp4?token=exp=1767628962~hmac=ced91ee0c11fc2b4a7dfa97e235b235bb285332b0bf5c5d134c2cadfdffca77c	2026-01-05 14:55:04.045361	2026-01-05 15:02:48.683884	1	\N
3	7bfa338e-3ff3-49a3-9a0e-99076916fe7c	1	1	seedance-lite-1080p	completed	https://cdn-magnific.freepik.com/kling_7bfa338e-3ff3-49a3-9a0e-99076916fe7c.mp4?token=exp=1767630679~hmac=1b0dfa8620c772951b7d974a6b743be19f6041aa68f5e48c2142fa64396203c5	2026-01-05 15:23:13.28322	2026-01-05 15:31:24.097646	1	\N
4	cf08f035-1ac5-415e-8766-281bb4391fe8	1	1	kling-v2-1-master	completed	https://cdn-magnific.freepik.com/kling_cf08f035-1ac5-415e-8766-281bb4391fe8.mp4?token=exp=1767630730~hmac=e847e0e6f9e4863e1a90841e07b80c43bd9e714e80698147899003e5898b87f5	2026-01-05 15:23:42.447088	2026-01-05 15:32:11.353176	1	\N
5	5340abe4-64bc-4769-b789-04b7f9f91800	1	1	kling-v2-5-pro	completed	https://cdn-magnific.freepik.com/kling_5340abe4-64bc-4769-b789-04b7f9f91800.mp4?token=exp=1767630769~hmac=1ad4ab7ccb4d11bceec63c713f8d814298ec8b1f0b3100b2c4fa96e348b5ba56	2026-01-05 15:23:59.67037	2026-01-05 15:32:49.913674	1	\N
6	11bce4ea-e2f8-433d-8329-5d901927d1d7	1	1	kling-v2-1-master	completed	https://cdn-magnific.freepik.com/kling_11bce4ea-e2f8-433d-8329-5d901927d1d7.mp4?token=exp=1767636374~hmac=470c72d7d1ba5e5cab0504cbb6b517ea853c56513bdb145b76d7a0a0a08c2a64	2026-01-05 16:58:19.909695	2026-01-05 17:06:16.088063	1	\N
7	16ab1fbc-e7a7-4e8e-a399-3a02cc1c9e8c	1	1	kling-v2-1-master	completed	https://cdn-magnific.freepik.com/kling_16ab1fbc-e7a7-4e8e-a399-3a02cc1c9e8c.mp4?token=exp=1767639361~hmac=3b48364d0f4d5f4457c97385bcbd30d3bd24f2fd8c6bf378f829ae930fc6512c	2026-01-05 17:48:31.565044	2026-01-05 17:56:02.273792	1	2
8	92fc4bf1-6801-4e00-a26e-3cd9d5210593	1	1	kling-v2-1-master	completed	https://cdn-magnific.freepik.com/kling_92fc4bf1-6801-4e00-a26e-3cd9d5210593.mp4?token=exp=1767641598~hmac=b9a9c1228b30b5f4202e98cbc20512f93ff44010fb469e583a30b9515b1cb722	2026-01-05 18:25:40.686937	2026-01-05 18:33:23.882569	1	2
9	54c9a9d0-1a84-4677-acf9-a53130320cbb	1	1	kling-v2-1-master	completed	https://cdn-magnific.freepik.com/kling_54c9a9d0-1a84-4677-acf9-a53130320cbb.mp4?token=exp=1767642193~hmac=548059af712c9e4f30185e76c63692150357a2397bed15010bca5ff0132619e6	2026-01-05 18:35:32.835955	2026-01-05 18:43:15.578243	1	2
\.


--
-- Data for Name: xclip_api_keys; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.xclip_api_keys (id, user_id, api_key, label, status, requests_count, last_used_at, created_at) FROM stdin;
1	1	xclip_HTi9CqpBmaxaRW1wKQ7yd7DArG3S2uSN	545745as	active	12	2026-01-05 18:35:32.17014	2026-01-05 14:15:43.488261
\.


--
-- Name: payments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.payments_id_seq', 1, true);


--
-- Name: rooms_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.rooms_id_seq', 3, true);


--
-- Name: subscription_plans_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.subscription_plans_id_seq', 4, true);


--
-- Name: subscriptions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.subscriptions_id_seq', 1, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.users_id_seq', 1, true);


--
-- Name: video_generation_tasks_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.video_generation_tasks_id_seq', 9, true);


--
-- Name: xclip_api_keys_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.xclip_api_keys_id_seq', 1, true);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: rooms rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (sid);


--
-- Name: subscription_plans subscription_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscription_plans
    ADD CONSTRAINT subscription_plans_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: video_generation_tasks video_generation_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.video_generation_tasks
    ADD CONSTRAINT video_generation_tasks_pkey PRIMARY KEY (id);


--
-- Name: xclip_api_keys xclip_api_keys_api_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.xclip_api_keys
    ADD CONSTRAINT xclip_api_keys_api_key_key UNIQUE (api_key);


--
-- Name: xclip_api_keys xclip_api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.xclip_api_keys
    ADD CONSTRAINT xclip_api_keys_pkey PRIMARY KEY (id);


--
-- Name: idx_session_expire; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_session_expire ON public.sessions USING btree (expire);


--
-- Name: payments payments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id);


--
-- Name: subscriptions subscriptions_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id);


--
-- Name: subscriptions subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: subscriptions subscriptions_xmaker_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_xmaker_room_id_fkey FOREIGN KEY (xmaker_room_id) REFERENCES public.rooms(id);


--
-- Name: video_generation_tasks video_generation_tasks_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.video_generation_tasks
    ADD CONSTRAINT video_generation_tasks_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id);


--
-- Name: video_generation_tasks video_generation_tasks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.video_generation_tasks
    ADD CONSTRAINT video_generation_tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: video_generation_tasks video_generation_tasks_xclip_api_key_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.video_generation_tasks
    ADD CONSTRAINT video_generation_tasks_xclip_api_key_id_fkey FOREIGN KEY (xclip_api_key_id) REFERENCES public.xclip_api_keys(id);


--
-- Name: xclip_api_keys xclip_api_keys_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.xclip_api_keys
    ADD CONSTRAINT xclip_api_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--

\unrestrict jHbFthYLUBsYAbehfn7UAdvXRiEDmdXsaDEWp5yXNlvk9LhlDfAAAJMbvcLJa82

