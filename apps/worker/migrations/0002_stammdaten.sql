-- Stammdaten: TE-Digital-Projekte (Bestandsaufnahme 19.11.2026) und KI-Mitarbeiter (Pflichtenheft Kap. 2, Entscheidung „nur Claude-Abo“)

INSERT INTO projekte (slug, name, kurz, beschreibung, repo_url, website_url, hosting, stack, farbe, status, sortierung) VALUES
('zentrale', 'TE-Digital Zentrale', 'Unternehmenssteuerung & Agentenkoordination',
 'Zentrale PWA zur Steuerung der KI-Mitarbeiter, Projekte, Aufgaben, Freigaben und des Unternehmenswissens.',
 NULL, NULL, 'Cloudflare Worker + D1 (EU), Workers Free', 'TypeScript, Hono, Preact, Vite, PWA', '#C8912A', 'aktiv', 10),
('website', 'TE-Digital Hauptwebsite', 'Portfolio-Seite aller Apps',
 'Plattform-Startseite te-alltagshelfer.org mit allen TE-Apps.',
 'https://github.com/TE-Tools/te-alltagstools-website', 'https://te-alltagshelfer.org', 'Cloudflare Worker te-alltag (Static Assets)', 'HTML/CSS, Worker', '#14161A', 'aktiv', 20),
('familienplaner', 'Familienplaner', 'Familien organisieren',
 'Familien-App mit Kalender, Aufgaben, Chat, Rezepten, Tagebuch und Push-Erinnerungen.',
 'https://github.com/TE-Tools/te-alltagstools-website', 'https://familienplaner.te-alltagshelfer.org', 'Cloudflare Workers (5), Firebase (Firestore, Auth, FCM)', 'React (Babel im Browser), Tailwind, Workers', '#047857', 'aktiv', 30),
('vereinsleben', 'TE-Vereinsleben', 'Vereine & Bruderschaften organisieren',
 'Vereinsverwaltung, ausgelagert aus Orchester Orga.',
 'https://github.com/TE-Tools/vereinsleben', 'https://verein.te-alltagshelfer.org', 'Cloudflare', '', '#1B4D3E', 'aktiv', 40),
('orchester', 'Orchester Orga', 'Orchester & Musiker organisieren',
 'Orchesterverwaltung mit Proben, Aushilfen, Anhängen, Web Push und Android-TWA.',
 'https://github.com/TE-Tools/orchester-orga', 'https://orchester-orga.pages.dev', 'Cloudflare Worker + D1 + R2, Pages', 'HTML/CSS/JS ohne Build, Worker', '#6B1F2A', 'aktiv', 50),
('minigames', 'TE-Mini-Games', 'Spiele für zwischendurch',
 'Offline-fähige Minispiele mit Multiplayer, Android-App über Capacitor.',
 'https://github.com/TE-Tools/TE-Mini-Games', 'https://te-mini-games.pages.dev', 'Cloudflare Pages, Supabase', 'React 19, Vite, TypeScript, Capacitor', '#5A3CE0', 'aktiv', 60),
('dragonguildmaster', 'DragonGuildMaster', 'Gildenverwaltung für WoW',
 'Website und API zur Gildenverwaltung, gekoppelt an das WoW-Addon.',
 'https://github.com/TE-Tools/DragonGuildMaster-Website', 'https://dragonguildmaster-web.pages.dev', 'Cloudflare Worker + D1 + R2, Pages', 'Vite, Hono, TypeScript', '#9B1C1F', 'aktiv', 70),
('dragonskill', 'DragonSkill', 'WoW-Addon',
 'WoW-Lua-Addons DragonGuildMaster und DragonSkill.',
 'https://github.com/TE-Tools/DrgonGuildMaster', NULL, 'Verteilung als ZIP', 'Lua', '#7A1518', 'aktiv', 80);

INSERT INTO mitarbeiter (id, name, rolle, anbieter, zugang, arbeitsweg, farbe, sortierung) VALUES
('projektleitung', 'ChatGPT', 'Zentrale Projektleitung', 'chatgpt', 'kostenlos', 'paket', '#10A37F', 10),
('technik',        'Claude Code', 'Technische Leitung', 'claude', 'abo', 'mcp', '#C8912A', 20),
('marketing',      'Gemini', 'Marketing & Vertrieb', 'gemini', 'kostenlos', 'paket', '#1D4ED8', 30),
('qualitaet',      'Grok', 'Qualität & Sicherheit', 'grok', 'kostenlos', 'paket', '#14161A', 40),
('produkt',        'Flexibel', 'Produktmanagement', 'flexibel', 'flexibel', 'flexibel', '#6E737C', 50);

INSERT INTO aktivitaeten (akteur_typ, akteur_name, aktion, objekt_typ, details) VALUES
('system', 'System', 'zentrale.eingerichtet', 'system', '{"hinweis":"Grundsystem Phase 2 angelegt"}');
