import { useState, useEffect, useCallback } from 'react';
import { decorItemsApi, DecorMasterItem } from './api';

export function useDecorItems() {
  const [raw,     setRaw]     = useState<DecorMasterItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await decorItemsApi.getAll();
      setRaw(data);
    } catch {
      // silently ignore — dropdowns will just be empty until next load
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Throws on failure so the caller (modal) can show an error alert
  const addItem = useCallback(async (name: string): Promise<void> => {
    const item = await decorItemsApi.create(name);
    setRaw(prev => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)));
  }, []);

  // Throws on failure so the caller (modal) can show an error alert
  const removeItem = useCallback(async (id: string): Promise<void> => {
    await decorItemsApi.remove(id);
    setRaw(prev => prev.filter(i => i._id !== id));
  }, []);

  return {
    items:     raw.map(i => i.name),   // string[] used in dropdowns
    rawItems:  raw,                     // DecorMasterItem[] used in manage modal
    loading,
    addItem,
    removeItem,
    reload: load,
  };
}
