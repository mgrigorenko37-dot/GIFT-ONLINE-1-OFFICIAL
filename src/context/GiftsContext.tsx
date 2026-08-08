import React, { createContext, useContext, useState, useEffect } from 'react';
import { type Gift, gifts as initialGifts } from '../data/gifts';
import { fetchTelegramGifts } from '../services/telegramGifts';

type GiftsContextType = {
  gifts: Gift[];
  loading: boolean;
};

const GiftsContext = createContext<GiftsContextType>({
  gifts: initialGifts,
  loading: false,
});

export const GiftsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [gifts, setGifts] = useState<Gift[]>(initialGifts);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    fetchTelegramGifts().then((data) => {
      setGifts(data);
      setLoading(false);
    });
  }, []);

  return (
    <GiftsContext.Provider value={{ gifts, loading }}>
      {children}
    </GiftsContext.Provider>
  );
};

export const useGifts = () => useContext(GiftsContext);
