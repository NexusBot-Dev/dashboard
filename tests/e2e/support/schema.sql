-- Test-Schema: die Tabellen, die das Dashboard direkt liest/schreibt.
-- Entspricht dem Produktiv-Schema, nur ohne utf8mb4_uca1400_ai_ci (gibt es erst ab MariaDB 11).

DROP TABLE IF EXISTS dashboard_sessions;
DROP TABLE IF EXISTS premium;
DROP TABLE IF EXISTS guild_settings;

CREATE TABLE `guild_settings` (
  `guild_id` bigint(20) NOT NULL,
  `log_channel_id` bigint(20) DEFAULT NULL,
  `rules_channel_id` bigint(20) DEFAULT NULL,
  `welcome_channel_id` bigint(20) DEFAULT NULL,
  `goodbye_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `goodbye_channel_id` bigint(20) DEFAULT NULL,
  `modules` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '{"moderation": true, "levels": false, "welcome": false, "reaction_roles": false, "boosts": false, "embeds": false, "automod": false, "stream_alerts": true, "tickets": true}' CHECK (json_valid(`modules`)),
  `setup_complete` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `color` int(11) DEFAULT 62932,
  `locale` varchar(5) NOT NULL DEFAULT 'de',
  `boost_channel_id` bigint(20) DEFAULT NULL,
  `left_at` datetime DEFAULT NULL,
  `timezone` varchar(50) NOT NULL DEFAULT 'UTC',
  `announcements_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `announcement_channel_id` bigint(20) DEFAULT NULL,
  `antinuke` tinyint(1) NOT NULL DEFAULT 0,
  `honeypot_channel_id` bigint(20) DEFAULT NULL,
  `ticket_log_channel_id` bigint(20) DEFAULT NULL,
  `brand_role_id` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`guild_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `premium` (
  `guild_id` bigint(20) NOT NULL,
  `expires_at` datetime DEFAULT NULL,
  `source` enum('discord','gift','manual') NOT NULL DEFAULT 'gift',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`guild_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `dashboard_sessions` (
  `id` varchar(64) NOT NULL,
  `discord_user_id` varchar(32) NOT NULL,
  `username` varchar(64) NOT NULL,
  `global_name` varchar(64) DEFAULT NULL,
  `avatar_url` varchar(255) DEFAULT NULL,
  `access_token` varchar(255) NOT NULL,
  `refresh_token` varchar(255) NOT NULL,
  `expires_at` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_discord_user` (`discord_user_id`),
  KEY `idx_expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
