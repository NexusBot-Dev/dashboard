// Plattformen der Stream-Alerts: Anzeigename und Markenfarbe (für PlatformIcon)
export const PLATFORM_META: Record<string, { label: string; colorClass: string }> = {
  twitch: { label: 'Twitch', colorClass: 'text-[#9146FF]' },
  youtube: { label: 'YouTube', colorClass: 'text-[#FF0000]' },
  kick: { label: 'Kick', colorClass: 'text-[#53FC18]' },
};

/** Ziel-Channel als Text: "#name", oder der Hinweis, dass er gelöscht wurde */
export const channelLabel = (channelName: string | null | undefined, deletedText: string) =>
  channelName ? `#${channelName}` : deletedText;

/** Eintrag in der Verknüpfungs-Auswahl. Gleiche Namen lassen sich so unterscheiden:
 *  "Gronkh (Twitch) → #live" und "Gronkh (YouTube) → #videos" */
export const subscriptionLabel = (streamerName: string, platform: string, channel: string) =>
  `${streamerName} (${PLATFORM_META[platform]?.label ?? platform}) → ${channel}`;
