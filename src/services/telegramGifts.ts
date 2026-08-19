export interface Gift {
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
  source?: 'postgres' | 'mock';
}

export interface GiftsApiResponse {
  source: 'postgres' | 'mock';
  count: number;
  data: Gift[];
  message?: string;
  warning?: string;
}

export const fetchTelegramGifts = async (): Promise<{ gifts: Gift[]; source: 'postgres' | 'mock' }> => {
  try {
    const res = await fetch('/api/gifts');
    if (res.ok) {
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const json = await res.json();
        
        // Handle new structured API response { source, count, data }
        if (json && Array.isArray(json.data)) {
          return {
            gifts: json.data,
            source: json.source || 'postgres',
          };
        }

        // Backward compatibility for raw array response
        if (Array.isArray(json)) {
          return {
            gifts: json,
            source: 'postgres',
          };
        }
      }
    }
    return {
      gifts: [],
      source: 'postgres',
    };
  } catch (error) {
    console.warn('[telegramGifts] Failed to fetch telegram gifts from API:', error);
    return {
      gifts: [],
      source: 'postgres',
    };
  }
};
