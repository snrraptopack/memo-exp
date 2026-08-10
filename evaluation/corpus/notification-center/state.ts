export interface Notice { id: number; message: string; read: boolean }

export const center = {
  notices: [] as Notice[],
  nextId: 1,
};
