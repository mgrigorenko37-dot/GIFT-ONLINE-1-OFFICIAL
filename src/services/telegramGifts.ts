import { gifts as fallbackGifts, type Gift } from '../data/gifts';

export const fetchTelegramGifts = async (): Promise<Gift[]> => {
  try {
    const res = await fetch('/api/gifts');
    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) {
        return data;
      }
    }
    console.warn('API returned empty or failed, using fallback mock gifts');
    return fallbackGifts;
  } catch (error) {
    console.error('Failed to fetch telegram gifts from API, using fallback', error);
    return fallbackGifts;
  }
};
