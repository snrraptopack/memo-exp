let sequence = 0;

export function createLocals() {
  return {
    requestId: `req-${String(++sequence)}`,
    visitor: 'anonymous',
  };
}
