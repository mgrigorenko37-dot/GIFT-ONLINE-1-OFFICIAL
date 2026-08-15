import { gifts as fallbackGifts, type Gift } from '../data/gifts';

export const fetchTelegramGifts = async (): Promise<Gift[]> => {
  try {
    const res = await fetch('/api/gifts');
    if (res.ok) {
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          return data;
        }
      }
    }
    return fallbackGifts;
  } catch (error) {
    console.warn('Failed to fetch telegram gifts from API, using fallback', error);
    return fallbackGifts;
  }
};
