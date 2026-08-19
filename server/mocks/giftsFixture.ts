export interface GiftItem {
  id: string;
  name: string;
  collection: string;
  rarity: string;
  floor: number;
  change: number;
  volume: string;
  className: string;
  emoji?: string;
  image_url?: string;
  is_nft?: boolean;
  total_supply?: number;
}

export interface GiftVariantItem {
  id: string;
  collection_id: string;
  model_name: string;
  symbol_name: string;
  backdrop_color: string;
  rarity_percentage: number;
  current_price_gx: number;
  image_url: string;
}

/**
 * Deterministic mock gift fixtures used exclusively when USE_MOCK_GIFTS=true in development.
 * All numbers and identifiers are completely deterministic with zero Math.random().
 */
export const MOCK_GIFTS_FIXTURE: GiftItem[] = [
  {
    id: 'plush-pepe',
    name: 'Plush Pepe',
    collection: 'Telegram Gifts',
    rarity: 'Legendary',
    floor: 1205.99,
    change: 3.25,
    volume: '88K',
    className: 'gx-gift-box',
    total_supply: 1000,
    is_nft: true,
  },
  {
    id: 'heart-locket',
    name: 'Heart Locket',
    collection: 'Telegram Gifts',
    rarity: 'Legendary',
    floor: 249.95,
    change: -4.75,
    volume: '72K',
    className: 'gx-gift-box',
    total_supply: 5000,
    is_nft: true,
  },
  {
    id: 'telegram-cap',
    name: 'Telegram Cap',
    collection: 'Telegram Gifts',
    rarity: 'Legendary',
    floor: 81.27,
    change: -3.75,
    volume: '55K',
    className: 'gx-gift-box',
    total_supply: 10000,
    is_nft: true,
  },
  {
    id: 'plum',
    name: 'Plum',
    collection: 'Telegram Gifts',
    rarity: 'Legendary',
    floor: 52.33,
    change: -1.25,
    volume: '22K',
    className: 'gx-gift-box',
    total_supply: 25000,
    is_nft: true,
  },
  {
    id: 'spartan-helmet',
    name: 'Spartan Helmet',
    collection: 'Telegram Gifts',
    rarity: 'Limited',
    floor: 33.59,
    change: 3.25,
    volume: '22K',
    className: 'gx-gift-box',
    total_supply: 50000,
    is_nft: true,
  },
  {
    id: 'diamond-crystal',
    name: 'Diamond Crystal',
    collection: 'Telegram Gifts',
    rarity: 'Limited',
    floor: 23.76,
    change: -3.25,
    volume: '94K',
    className: 'gx-gift-box',
    total_supply: 50000,
    is_nft: true,
  },
  {
    id: 'birkin-bag',
    name: 'Birkin Bag',
    collection: 'Telegram Gifts',
    rarity: 'Limited',
    floor: 22.81,
    change: 4.25,
    volume: '71K',
    className: 'gx-gift-box',
    total_supply: 50000,
    is_nft: true,
  },
  {
    id: 'golden-biceps',
    name: 'Golden Biceps',
    collection: 'Telegram Gifts',
    rarity: 'Limited',
    floor: 22.32,
    change: -4.25,
    volume: '54K',
    className: 'gx-gift-box',
    total_supply: 50000,
    is_nft: true,
  },
  {
    id: 'nail-bracelet',
    name: 'Nail Bracelet',
    collection: 'Telegram Gifts',
    rarity: 'Limited',
    floor: 22.15,
    change: -2.75,
    volume: '38K',
    className: 'gx-gift-box',
    total_supply: 50000,
    is_nft: true,
  },
  {
    id: 'swiss-watch',
    name: 'Swiss Watch',
    collection: 'Telegram Gifts',
    rarity: 'Rare',
    floor: 18.5,
    change: 1.5,
    volume: '42K',
    className: 'gx-gift-box',
    total_supply: 100000,
    is_nft: true,
  },
  {
    id: 'durov-cap',
    name: "Durov's Cap",
    collection: 'Telegram Gifts',
    rarity: 'Legendary',
    floor: 124.0,
    change: 2.1,
    volume: '65K',
    className: 'gift-cap',
    emoji: '🧢',
    total_supply: 2000,
    is_nft: true,
  },
  {
    id: 'cherry-blossom',
    name: 'Cherry Blossom',
    collection: 'Telegram Gifts',
    rarity: 'Rare',
    floor: 14.2,
    change: -0.8,
    volume: '31K',
    className: 'gift-cherry',
    emoji: '🌸',
    total_supply: 75000,
    is_nft: true,
  },
  {
    id: 'lollipop',
    name: 'Lollipop',
    collection: 'Telegram Gifts',
    rarity: 'Common',
    floor: 4.5,
    change: 0.5,
    volume: '18K',
    className: 'gift-lollipop',
    emoji: '🍭',
    total_supply: 200000,
    is_nft: true,
  },
];

export const MOCK_VARIANTS_FIXTURE: GiftVariantItem[] = MOCK_GIFTS_FIXTURE.flatMap((g) => {
  const models = ['Standard', 'Holographic', 'Gold', 'Diamond'];
  const backdrops = ['#ff0000', '#00ff00', '#0000ff', '#f0f0f0', '#2a2a2a'];
  const rarityTiers = [45.0, 25.0, 15.0, 10.0, 5.0];

  return [0, 1, 2, 3, 4].map((i) => ({
    id: `${g.id}-var-${i}`,
    collection_id: g.id,
    model_name: models[i % models.length],
    symbol_name: 'Original',
    backdrop_color: backdrops[i % backdrops.length],
    rarity_percentage: rarityTiers[i % rarityTiers.length],
    current_price_gx: parseFloat((g.floor * (1 + i * 0.1)).toFixed(2)),
    image_url: g.image_url || '',
  }));
});
