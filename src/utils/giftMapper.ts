export const TELEGRAM_GIFT_MAP: Record<string, { id: string, name: string, className: string }> = {
  "🧢": { id: "durov-cap", name: "Durov's Cap", className: "gift-cap" },
  "🌸": { id: "cherry-blossom", name: "Cherry Blossom", className: "gift-cherry" },
  "🍭": { id: "lollipop", name: "Lollipop", className: "gift-lollipop" },
  "🐸": { id: "plush-pepe", name: "Plush Pepe", className: "gift-pepe" },
  "🧿": { id: "evil-eye", name: "Evil Eye", className: "gift-eye" },
  "🐦": { id: "blue-bird", name: "Blue Bird", className: "gift-bird" },
  "🫐": { id: "berry-box", name: "Berry Box", className: "gift-berry" },
  "📅": { id: "desk-calendar", name: "Desk Calendar", className: "gift-calendar" },
  "🔔": { id: "jingle-bells", name: "Jingle Bells", className: "gift-bells" },
  "🧧": { id: "red-envelope", name: "Red Envelope", className: "gift-envelope" },
  "💍": { id: "diamond-ring", name: "Diamond Ring", className: "gift-ring" },
  "🎃": { id: "spooky-pumpkin", name: "Spooky Pumpkin", className: "gift-pumpkin" },
  "👻": { id: "ghost", name: "Ghost", className: "gift-ghost" },
  "🐈‍⬛": { id: "black-cat", name: "Black Cat", className: "gift-cat" },
  "🧙‍♀️": { id: "witch-hat", name: "Witch Hat", className: "gift-witch-hat" },
  "🍰": { id: "delicious-cake", name: "Delicious Cake", className: "gift-cake" },
  "🧪": { id: "magic-potion", name: "Magic Potion", className: "gift-potion" },
  "👽": { id: "alien", name: "Alien", className: "gift-alien" },
  "🎄": { id: "christmas-tree", name: "Christmas Tree", className: "gift-tree" },
  "🎁": { id: "gift-box", name: "Gift Box", className: "gift-box" }
};

export const mapTelegramGift = (tgGift: any) => {
  const emoji = tgGift.sticker?.emoji;
  const mapped = TELEGRAM_GIFT_MAP[emoji];

  let rarity = 'Common';
  if (tgGift.total_count <= 1000) rarity = 'Legendary';
  else if (tgGift.total_count <= 10000) rarity = 'Epic';
  else if (tgGift.total_count <= 50000) rarity = 'Rare';

  return {
    id: mapped?.id || tgGift.id || `unknown-${emoji || 'gift'}`,
    name: mapped?.name || (emoji ? `${emoji} Gift` : 'Unknown Gift'),
    collection: 'Telegram Gifts',
    rarity,
    floor: tgGift.star_count || 0,
    change: parseFloat((Math.random() * 10 - 5).toFixed(2)),
    volume: `${Math.floor(Math.random() * 200)}K`,
    className: mapped?.className || 'gift-default',
    telegramId: tgGift.id, // Keep the real ID for API actions if needed
  };
};
