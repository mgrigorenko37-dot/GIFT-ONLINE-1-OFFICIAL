import React, { createContext, useContext, useState, useEffect } from 'react';
import { type Gift, fetchTelegramGifts } from '../services/telegramGifts';
import { gifts as defaultGifts } from '../data/gifts';

type GiftsContextType = {
  gifts: Gift[];
  source: 'postgres' | 'mock';
  loading: boolean;
};

const GiftsContext = createContext<GiftsContextType>({
  gifts: defaultGifts,
  source: 'postgres',
  loading: false,
});

export const GiftsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [gifts, setGifts] = useState<Gift[]>(defaultGifts);
  const [source, setSource] = useState<'postgres' | 'mock'>('postgres');
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    fetchTelegramGifts().then((res) => {
      if (res.gifts && res.gifts.length > 0) {
        setGifts(res.gifts);
        setSource(res.source);
      }
      setLoading(false);
    });
  }, []);

  return (
    <GiftsContext.Provider value={{ gifts, source, loading }}>{children}</GiftsContext.Provider>
  );
};

export const useGifts = () => useContext(GiftsContext);
